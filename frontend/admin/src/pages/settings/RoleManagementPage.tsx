import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tabs,
  Table,
  Tag,
  Tree,
  message,
} from 'antd';
import type { TableProps, TreeDataNode } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  createRole,
  deleteRole,
  listRoles,
  updateRole,
} from '../../api/role';
import { getRouteResourceTree } from '../../api/route-resource';
import type {
  ManagedRole,
  ManagedRouteResource,
  RoleCreatePayload,
  RoleUpdatePayload,
  RouteResourcePlatform,
} from '../../types';

type RoleEditorState = {
  mode: 'create' | 'edit';
  role: ManagedRole | null;
};

type RoleFormValues = {
  name: string;
  description?: string;
  grantedResourceIds?: string[];
  isDefault?: boolean;
};

function normalizeResourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)));
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') {
      return true;
    }
    if (value === '0' || value.toLowerCase() === 'false') {
      return false;
    }
  }
  return fallback;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRouteResource(raw: unknown): ManagedRouteResource | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = normalizeText(record.id);
  if (!id) {
    return null;
  }

  const childrenSource = Array.isArray(record.children)
    ? record.children
    : Array.isArray(record.items)
      ? record.items
      : [];

  const children = childrenSource
    .map((child) => normalizeRouteResource(child))
    .filter((child): child is ManagedRouteResource => Boolean(child));

  return {
    id,
    parentId: normalizeText(record.parentId ?? record.parent_id) || null,
    name: normalizeText(record.name),
    resourceKey: normalizeText(record.resourceKey ?? record.resource_key),
    resourceType: (normalizeText(record.resourceType ?? record.resource_type) || 'menu') as ManagedRouteResource['resourceType'],
    platform: (normalizeText(record.platform) || 'web') as ManagedRouteResource['platform'],
    permissionCode: normalizeText(record.permissionCode ?? record.permission_code),
    path: normalizeText(record.path),
    status: normalizeBoolean(record.status, true),
    isSystem: normalizeBoolean(record.isSystem ?? record.is_system),
    children,
  };
}

function normalizeRouteResourceList(raw: unknown): ManagedRouteResource[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (
        (raw as { items?: unknown[] }).items
        || (raw as { list?: unknown[] }).list
        || (raw as { tree?: unknown[] }).tree
        || (raw as { data?: unknown[] }).data
        || []
      )
      : [];

  return source
    .map((item) => normalizeRouteResource(item))
    .filter((item): item is ManagedRouteResource => Boolean(item));
}

function flattenRouteResources(records: ManagedRouteResource[]): ManagedRouteResource[] {
  return records.flatMap((record) => [record, ...flattenRouteResources(record.children || [])]);
}

function normalizeRole(raw: ManagedRole): ManagedRole {
  const grantedResources = Array.isArray(raw.grantedResources) ? raw.grantedResources : [];
  const grantedResourceIds = Array.isArray(raw.grantedResourceIds)
    ? raw.grantedResourceIds
    : grantedResources.map((resource) => resource.resourceKey);

  return {
    ...raw,
    grantedResources,
    grantedResourceIds,
  };
}

function resourceTypeLabel(resourceType: ManagedRouteResource['resourceType']) {
  switch (resourceType) {
    case 'directory':
      return '目录';
    case 'menu':
      return '菜单';
    default:
      return resourceType;
  }
}

function buildTreeNodes(resources: ManagedRouteResource[]): TreeDataNode[] {
  return resources
    .filter((resource) => resource.status !== false)
    .map((resource) => ({
      key: resource.resourceKey,
      title: (
        <Space direction="vertical" size={2}>
          <Space size={6} wrap>
            <span>{resource.name}</span>
            <Tag color={resource.platform === 'admin' ? 'gold' : resource.platform === 'web' ? 'cyan' : 'default'}>
              {resource.platform.toUpperCase()}
            </Tag>
            <Tag>{resourceTypeLabel(resource.resourceType)}</Tag>
          </Space>
          <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
            {resource.permissionCode || resource.resourceKey}
          </span>
        </Space>
      ),
      children: buildTreeNodes(resource.children || []),
    }));
}

function collectSelectableResourceIds(resources: ManagedRouteResource[]) {
  return flattenRouteResources(resources)
    .filter((resource) => resource.status !== false)
    .map((resource) => resource.resourceKey);
}

function resolveRoleSelection(role: ManagedRole) {
  if (role.grantedResourceIds && role.grantedResourceIds.length > 0) {
    return Array.from(new Set(role.grantedResourceIds));
  }

  if (role.grantedResources && role.grantedResources.length > 0) {
    return Array.from(new Set(role.grantedResources.map((resource) => resource.resourceKey)));
  }

  return [];
}

function buildRolePayload(
  values: RoleFormValues,
): RoleCreatePayload | RoleUpdatePayload {
  const resourceIds = normalizeResourceIds(values.grantedResourceIds);

  return {
    name: values.name.trim(),
    description: values.description?.trim() || '',
    resourceIds,
    isDefault: Boolean(values.isDefault),
  };
}

const resourcePlatformTabs: Array<{ key: RouteResourcePlatform; label: string }> = [
  { key: 'web', label: 'Web 权限' },
  { key: 'admin', label: 'Admin 权限' },
];

function filterResourcesByPlatform(resources: ManagedRouteResource[], platform: RouteResourcePlatform) {
  return resources.filter((resource) => resource.platform === platform);
}

export function RoleManagementPage() {
  const [form] = Form.useForm<RoleFormValues>();
  const watchedGrantedResourceIds = normalizeResourceIds(Form.useWatch('grantedResourceIds', form));
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [resourceTree, setResourceTree] = useState<ManagedRouteResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<RoleEditorState | null>(null);
  const [resourceLoadError, setResourceLoadError] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<RouteResourcePlatform>('web');

  const flattenedResources = useMemo(
    () => flattenRouteResources(resourceTree),
    [resourceTree],
  );
  const selectableResourceIds = useMemo(
    () => collectSelectableResourceIds(resourceTree),
    [resourceTree],
  );
  const resourceById = useMemo(
    () => new Map(flattenedResources.map((resource) => [resource.resourceKey, resource] as const)),
    [flattenedResources],
  );
  const resourceTreesByPlatform = useMemo(
    () => Object.fromEntries(
      resourcePlatformTabs.map(({ key }) => [key, filterResourcesByPlatform(resourceTree, key)]),
    ) as Record<RouteResourcePlatform, ManagedRouteResource[]>,
    [resourceTree],
  );
  const selectableResourceIdsByPlatform = useMemo(
    () => Object.fromEntries(
      resourcePlatformTabs.map(({ key }) => [key, collectSelectableResourceIds(resourceTreesByPlatform[key])]),
    ) as Record<RouteResourcePlatform, string[]>,
    [resourceTreesByPlatform],
  );
  const visibleResourcePlatformTabs = useMemo(
    () => resourcePlatformTabs.filter(({ key }) => resourceTreesByPlatform[key].length > 0),
    [resourceTreesByPlatform],
  );

  useEffect(() => {
    if (visibleResourcePlatformTabs.length === 0) {
      return;
    }
    if (!visibleResourcePlatformTabs.some((item) => item.key === activePlatform)) {
      setActivePlatform(visibleResourcePlatformTabs[0].key);
    }
  }, [activePlatform, visibleResourcePlatformTabs]);

  async function loadPageData() {
    setLoading(true);
    setResourceLoadError(null);

    try {
      const rolesPromise = listRoles().then((items) => items.map((role) => normalizeRole(role)));

      const resourcesPromise = getRouteResourceTree({ includeDisabled: true })
        .then((response) => normalizeRouteResourceList(response));

      const [nextRoles, nextResources] = await Promise.all([rolesPromise, resourcesPromise]);
      setRoles(nextRoles);
      setResourceTree(nextResources);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : '角色数据加载失败';
      setRoles([]);
      setResourceTree([]);
      message.error(messageText);
      setResourceLoadError(messageText);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPageData();
  }, []);

  function openCreateModal() {
    form.resetFields();
    form.setFieldsValue({
      name: '',
      description: '',
      grantedResourceIds: [],
      isDefault: false,
    });
    setEditorState({ mode: 'create', role: null });
  }

  function openEditModal(role: ManagedRole) {
    form.setFieldsValue({
      name: role.name,
      description: role.description || '',
      grantedResourceIds: resolveRoleSelection(role),
      isDefault: Boolean(role.isDefault),
    });
    setEditorState({ mode: 'edit', role });
  }

  async function handleSubmit(values: RoleFormValues) {
    if (resourceTree.length === 0) {
      message.warning('缺少可分配资源树，请先完成 route-resource 后端接口。');
      return;
    }

    setSaving(true);
    try {
      const payload = buildRolePayload(values);
      if (editorState?.mode === 'create') {
        await createRole(payload);
        message.success('角色已创建');
      } else if (editorState?.role) {
        await updateRole(editorState.role.id, payload);
        message.success('角色已更新');
      }
      setEditorState(null);
      await loadPageData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '角色保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: ManagedRole) {
    setDeletingRoleId(role.id);
    try {
      await deleteRole(role.id);
      message.success('角色已删除');
      await loadPageData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '角色删除失败');
    } finally {
      setDeletingRoleId(null);
    }
  }

  const columns: TableProps<ManagedRole>['columns'] = [
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 240,
      render: (value: string, record) => (
          <Space direction="vertical" size={2}>
            <Space size={8} wrap>
              <strong>{value}</strong>
              {record.isDefault ? <Tag color="blue">默认角色</Tag> : null}
              {record.isSystem ? <Tag color="gold">系统角色</Tag> : null}
            </Space>
        </Space>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      render: (value?: string | null) => value?.trim() || '未填写',
    },
    {
      title: '资源数',
      width: 120,
      render: (_value, record) => `${record.grantedResourceIds?.length || 0} 项`,
    },
    {
      title: '已分配账号',
      width: 140,
      render: (_value, record) => `${record.assignedUserCount ?? 0} 人`,
    },
    {
      title: '授权预览',
      width: 420,
      render: (_value, record) => {
        const previewItems = record.grantedResourceIds?.length
          ? record.grantedResourceIds
            .map((resourceId) => resourceById.get(resourceId))
            .filter((resource): resource is ManagedRouteResource => Boolean(resource))
            .map((resource) => ({ key: resource.resourceKey, label: resource.name }))
          : [];

        return (
          <Space size={[6, 6]} wrap>
            {previewItems.slice(0, 5).map((item) => (
              <Tag key={item.key}>{item.label}</Tag>
            ))}
            {previewItems.length > 5 ? <Tag>+{previewItems.length - 5}</Tag> : null}
            {previewItems.length === 0 ? <Tag>未配置</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: 220,
      render: (_value, record) => {
        const hasAssignedUsers = (record.assignedUserCount ?? 0) > 0;
        const deleteDisabled = Boolean(record.isSystem) || hasAssignedUsers;

        return (
          <Space wrap>
            <Button onClick={() => openEditModal(record)}>编辑</Button>
            <Popconfirm
              title="确认删除该角色吗？"
              description={deleteDisabled
                ? record.isSystem
                  ? '系统角色不允许删除'
                  : '请先解除账号绑定后再删除'
                : '删除后无法恢复，请确认该角色已不再使用。'}
              okButtonProps={{ danger: true }}
              okText="删除"
              cancelText="取消"
              disabled={deleteDisabled}
              onConfirm={() => void handleDelete(record)}
            >
              <Button danger disabled={deleteDisabled} loading={deletingRoleId === record.id}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <p>维护可分配的业务角色，可配置资源树分配 Web / Admin 菜单权限。</p>
        </section>

        {resourceLoadError ? (
          <Alert
            showIcon
            type="warning"
            message="资源树接口尚未就绪"
            description={resourceLoadError}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <section className="settings-section">
          <div className="settings-section-actions">
            <Space size={12}>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadPageData()}>
                刷新
              </Button>
              <Button icon={<PlusOutlined />} onClick={openCreateModal} type="primary" disabled={resourceTree.length === 0}>
                新建角色
              </Button>
            </Space>
          </div>

          <Table
            columns={columns}
            dataSource={roles}
            loading={loading}
            rowKey="id"
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个角色`,
            }}
            scroll={{ x: 1380 }}
          />
        </section>
      </section>

      <Modal
        destroyOnClose
        onCancel={() => setEditorState(null)}
        onOk={() => void form.submit()}
        okText={editorState?.mode === 'create' ? '创建角色' : '保存修改'}
        confirmLoading={saving}
        open={Boolean(editorState)}
        title={editorState?.mode === 'create' ? '新建角色' : '编辑角色'}
        width={920}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          <Form.Item
            label="角色名称"
            name="name"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input maxLength={64} placeholder="例如：内容运营" />
          </Form.Item>

          {editorState?.mode === 'edit' && editorState.role ? (
            null
          ) : null}

          <Form.Item
            label="角色说明"
            name="description"
          >
            <Input.TextArea maxLength={200} rows={3} placeholder="说明该角色可以访问哪些业务模块" />
          </Form.Item>

          <Form.Item
            name="grantedResourceIds"
            hidden
          />

          <Card
            size="small"
            title="资源授权"
            styles={{
              body: { paddingTop: 8 },
            }}
          >
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Tabs
                activeKey={activePlatform}
                onChange={(key) => setActivePlatform(key as RouteResourcePlatform)}
                items={visibleResourcePlatformTabs.map(({ key, label }) => ({
                  key,
                  label,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Space wrap>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => {
                            const current = new Set(normalizeResourceIds(form.getFieldValue('grantedResourceIds')));
                            selectableResourceIdsByPlatform[key].forEach((resourceId) => current.add(resourceId));
                            form.setFieldValue('grantedResourceIds', Array.from(current));
                          }}
                        >
                          全选当前页签
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => {
                            const removeIds = new Set(selectableResourceIdsByPlatform[key]);
                            form.setFieldValue(
                              'grantedResourceIds',
                              normalizeResourceIds(form.getFieldValue('grantedResourceIds'))
                                .filter((resourceId) => !removeIds.has(resourceId)),
                            );
                          }}
                        >
                          清空当前页签
                        </Button>
                      </Space>
                      <div style={{ maxHeight: 420, overflow: 'auto', paddingRight: 8 }}>
                        <Tree
                          checkable
                          defaultExpandAll
                          treeData={buildTreeNodes(resourceTreesByPlatform[key])}
                          checkedKeys={watchedGrantedResourceIds.filter((resourceId) => resourceById.get(resourceId)?.platform === key)}
                          onCheck={(checkedKeys) => {
                            const platformResourceIds = new Set(selectableResourceIdsByPlatform[key]);
                            const checkedPlatformKeys = new Set(
                              (Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked)
                                .filter((item): item is string => typeof item === 'string'),
                            );
                            const currentOtherKeys = normalizeResourceIds(form.getFieldValue('grantedResourceIds'))
                              .filter((resourceId) => !platformResourceIds.has(resourceId));
                            form.setFieldValue('grantedResourceIds', [
                              ...currentOtherKeys,
                              ...Array.from(checkedPlatformKeys),
                            ]);
                          }}
                        />
                      </div>
                    </Space>
                  ),
                }))}
              />

              <Form.Item name="isDefault" valuePropName="checked">
                <Checkbox>设为默认角色</Checkbox>
              </Form.Item>
            </Space>
          </Card>
        </Form>
      </Modal>
    </ContentStudioLayout>
  );
}
