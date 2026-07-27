import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Table,
  Tag,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  createRouteResource,
  deleteRouteResource,
  getRouteResourceTree,
  updateRouteResource,
} from '../../api/route-resource';
import type {
  ManagedRouteResource,
  RouteResourceMutationPayload,
  RouteResourcePlatform,
  RouteResourceType,
  RouteResourceVisibilityMode,
} from '../../types';
import './RouteResourceManagementPage.scss';

type EditorState = {
  mode: 'create' | 'edit';
  record: ManagedRouteResource | null;
};

type RouteResourceFormValues = {
  parentId?: string | null;
  name: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  path?: string;
  permissionCode: string;
  visibilityMode: RouteResourceVisibilityMode;
  status?: boolean;
  sortOrder?: number;
};

type RouteResourceRecord = ManagedRouteResource & {
  depth?: number;
  children?: RouteResourceRecord[];
};

const resourceTypeOptions: Array<{ label: string; value: RouteResourceType }> = [
  { label: '目录', value: 'directory' },
  { label: '菜单', value: 'menu' },
];

const platformOptions: Array<{ label: string; value: RouteResourcePlatform }> = [
  { label: 'Web', value: 'web' },
  { label: 'Admin', value: 'admin' },
];

const visibilityModeOptions: Array<{ label: string; value: RouteResourceVisibilityMode }> = [
  { label: '有权限时显示', value: 'permission' },
  { label: '始终显示', value: 'always' },
];

const platformTabs = platformOptions.map((item) => ({
  key: item.value,
  label: item.label,
}));

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

function normalizeRouteResource(raw: unknown, depth = 0): RouteResourceRecord | null {
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

  const normalizedChildren = childrenSource
    .map((child) => normalizeRouteResource(child, depth + 1))
    .filter((child): child is RouteResourceRecord => Boolean(child));

  return {
    depth,
    id,
    parentId: normalizeText(record.parentId ?? record.parent_id) || null,
    name: normalizeText(record.name),
    resourceKey: normalizeText(record.resourceKey ?? record.resource_key),
    resourceType: (normalizeText(record.resourceType ?? record.resource_type) || 'menu') as RouteResourceType,
    platform: (normalizeText(record.platform) || 'web') as RouteResourcePlatform,
    permissionCode: normalizeText(record.permissionCode ?? record.permission_code),
    visibilityMode: normalizeText(record.visibilityMode ?? record.visibility_mode) === 'always' ? 'always' : 'permission',
    path: normalizeText(record.path),
    status: normalizeBoolean(record.status, true),
    sortOrder: typeof record.sortOrder === 'number'
      ? record.sortOrder
      : typeof record.sort_order === 'number'
        ? record.sort_order
        : Number(record.sortOrder ?? record.sort_order ?? 0),
    isSystem: normalizeBoolean(record.isSystem ?? record.is_system),
    createdAt: normalizeText(record.createdAt ?? record.created_at),
    updatedAt: normalizeText(record.updatedAt ?? record.updated_at),
    children: normalizedChildren,
  };
}

function normalizeRouteResourceList(raw: unknown): RouteResourceRecord[] {
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
    .filter((item): item is RouteResourceRecord => Boolean(item));
}

function flattenRouteResources(records: RouteResourceRecord[]): RouteResourceRecord[] {
  return records.flatMap((record) => [record, ...flattenRouteResources(record.children || [])]);
}

function resourceTypeLabel(type: RouteResourceType) {
  switch (type) {
    case 'directory':
      return { color: 'blue', text: '目录' };
    case 'menu':
      return { color: 'geekblue', text: '菜单' };
    default:
      return { color: 'default', text: type };
  }
}

function buildMutationPayload(values: RouteResourceFormValues): RouteResourceMutationPayload {
  return {
    parentId: values.parentId || null,
    name: values.name.trim(),
    resourceKey: values.resourceKey.trim(),
    resourceType: values.resourceType,
    platform: values.platform,
    path: values.path?.trim() || '',
    permissionCode: values.permissionCode.trim(),
    visibilityMode: values.visibilityMode,
    status: Boolean(values.status),
    sortOrder: Number(values.sortOrder || 0),
  };
}

export function RouteResourceManagementPage() {
  const [form] = Form.useForm<RouteResourceFormValues>();
  const [treeData, setTreeData] = useState<RouteResourceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<RouteResourcePlatform>('web');
  const [keyword, setKeyword] = useState('');

  const allResources = useMemo(
    () => flattenRouteResources(treeData),
    [treeData],
  );

  const parentOptions = useMemo(
    () => allResources.map((resource) => ({
      label: `${resource.name} · ${resource.resourceKey}`,
      value: resource.id,
    })),
    [allResources],
  );

  const filteredTreeData = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    function matchRecord(record: RouteResourceRecord): RouteResourceRecord | null {
      const children = (record.children || [])
        .map((child) => matchRecord(child))
        .filter((child): child is RouteResourceRecord => Boolean(child));
      const haystack = [
        record.name,
        record.resourceKey,
        record.permissionCode,
        record.path || '',
      ].join(' ').toLowerCase();
      const matchesKeyword = !normalizedKeyword || haystack.includes(normalizedKeyword);

      if (matchesKeyword || children.length > 0) {
        return {
          ...record,
          children,
        };
      }

      return null;
    }

    return treeData
      .map((record) => matchRecord(record))
      .filter((record): record is RouteResourceRecord => Boolean(record));
  }, [keyword, treeData]);

  async function loadResources() {
    setLoading(true);
    try {
      const nextTree = normalizeRouteResourceList(await getRouteResourceTree({
        includeDisabled: true,
        platform: activePlatform,
      }));

      setTreeData(nextTree);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '路由资源加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadResources();
  }, [activePlatform]);

  function openCreateModal(parent?: ManagedRouteResource) {
    form.resetFields();
    form.setFieldsValue({
      parentId: parent?.id || null,
      name: '',
      resourceKey: '',
      resourceType: parent ? 'menu' : 'directory',
      platform: parent?.platform || activePlatform,
      path: '',
      permissionCode: '',
      visibilityMode: 'permission',
      status: true,
      sortOrder: 0,
    });
    setEditorState({ mode: 'create', record: parent || null });
  }

  function openEditModal(record: ManagedRouteResource) {
    form.setFieldsValue({
      parentId: record.parentId || null,
      name: record.name,
      resourceKey: record.resourceKey,
      resourceType: record.resourceType,
      platform: record.platform,
      path: record.path || '',
      permissionCode: record.permissionCode,
      visibilityMode: record.visibilityMode || 'permission',
      status: record.status ?? true,
      sortOrder: record.sortOrder ?? 0,
    });
    setEditorState({ mode: 'edit', record });
  }

  async function handleSave(values: RouteResourceFormValues) {
    setSaving(true);
    try {
      const payload = buildMutationPayload(values);
      if (editorState?.mode === 'edit' && editorState.record) {
        await updateRouteResource(editorState.record.id, payload);
        message.success('路由资源已更新');
      } else {
        await createRouteResource(payload);
        message.success('路由资源已创建');
      }
      setEditorState(null);
      await loadResources();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '路由资源保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickToggle(record: ManagedRouteResource, nextValue: boolean) {
    try {
      await updateRouteResource(record.id, {
        parentId: record.parentId || null,
        name: record.name,
        resourceKey: record.resourceKey,
        resourceType: record.resourceType,
        platform: record.platform,
        path: record.path || '',
        permissionCode: record.permissionCode,
        visibilityMode: record.visibilityMode || 'permission',
        status: nextValue,
        sortOrder: record.sortOrder ?? 0,
      });
      message.success('启用状态已更新');
      await loadResources();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '状态更新失败');
    }
  }

  async function handleDelete(record: ManagedRouteResource) {
    setDeletingResourceId(record.id);
    try {
      await deleteRouteResource(record.id);
      message.success('路由资源已删除');
      await loadResources();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '路由资源删除失败');
    } finally {
      setDeletingResourceId(null);
    }
  }

  const columns: TableProps<RouteResourceRecord>['columns'] = [
    {
      title: '资源节点',
      dataIndex: 'name',
      width: 280,
      render: (value: string, record) => (
        <Space
          className={`route-resource-node${record.depth ? ' route-resource-node--child' : ''}${record.children?.length ? ' route-resource-node--has-children' : ''}`}
          direction="vertical"
          size={2}
          style={{ '--route-resource-depth': record.depth || 0 } as CSSProperties}
        >
          <Space size={8} wrap>
            <strong>{value}</strong>
            {record.parentId ? <Tag color="blue">子级</Tag> : null}
            {record.isSystem ? <Tag color="gold">系统</Tag> : null}
          </Space>
          <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
            {record.resourceKey}
          </span>
        </Space>
      ),
    },
    {
      title: '类型',
      width: 110,
      render: (_value, record) => {
        const typeMeta = resourceTypeLabel(record.resourceType);
        return (
          <Space size={[6, 6]} wrap>
            <Tag color={typeMeta.color}>{typeMeta.text}</Tag>
          </Space>
        );
      },
    },
    {
      title: '路径',
      width: 240,
      render: (_value, record) => record.path || '未配置',
    },
    {
      title: '权限标识',
      dataIndex: 'permissionCode',
      width: 260,
      render: (value: string) => <Tag>{value || '未配置'}</Tag>,
    },
    {
      title: '菜单可见性',
      dataIndex: 'visibilityMode',
      width: 130,
      render: (value: RouteResourceVisibilityMode) => value === 'always'
        ? <Tag color="green">始终显示</Tag>
        : <Tag>按权限显示</Tag>,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 90,
      render: (value?: number) => value ?? 0,
    },
    {
      title: '启用',
      width: 90,
      render: (_value, record) => (
        <Switch
          checked={record.status ?? true}
          onChange={(nextValue) => void handleQuickToggle(record, nextValue)}
        />
      ),
    },
    {
      title: '操作',
      width: 240,
      render: (_value, record) => {
        const deleteDisabled = Boolean(record.isSystem) || (record.children?.length || 0) > 0;

        return (
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => openCreateModal(record)}>
              新增下级
            </Button>
            <Button icon={<EditOutlined />} onClick={() => openEditModal(record)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除该路由资源吗？"
              description={deleteDisabled
                ? record.isSystem
                  ? '系统资源不允许删除'
                  : '请先删除或迁移子节点后再删除'
                : '删除后角色授权会同步失效，请确认不再使用。'}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={deleteDisabled}
              onConfirm={() => void handleDelete(record)}
            >
              <Button danger disabled={deleteDisabled} loading={deletingResourceId === record.id}>
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
      <section className="settings-page route-resource-page">
        <section className="settings-header">
          <p>按 Web / Admin 维护目录和菜单资源</p>
        </section>

        <section className="settings-section">
          <div className="settings-section-actions">
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="搜索名称 / 资源键 / 权限码 / 路径"
                style={{ width: 320 }}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </Space>
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadResources()}>
                刷新
              </Button>
              <Button icon={<PlusOutlined />} onClick={() => openCreateModal()} type="primary">
                新建资源
              </Button>
            </Space>
          </div>

          <Tabs
            activeKey={activePlatform}
            onChange={(key) => setActivePlatform(key as RouteResourcePlatform)}
            items={platformTabs.map((tab) => ({
              ...tab,
              children: (
                <Card className="route-resource-table-card">
                  <Table
                    className="route-resource-table"
                    columns={columns}
                    dataSource={filteredTreeData}
                    expandable={{
                      expandIcon: ({ expanded, onExpand, record }) => {
                        if (!record.children?.length) {
                          return null;
                        }
                        return (
                          <button
                            aria-label={expanded ? '收起下级资源' : '展开下级资源'}
                            onClick={(event) => onExpand(record, event)}
                            style={{
                              alignItems: 'center',
                              background: 'transparent',
                              border: 0,
                              color: 'inherit',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              height: 22,
                              justifyContent: 'center',
                              marginRight: 8,
                              padding: 0,
                              width: 22,
                            }}
                            type="button"
                          >
                            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                          </button>
                        );
                      },
                    }}
                    loading={loading}
                    pagination={false}
                    rowKey="id"
                    scroll={{ x: 1100, y: 'calc(100vh - 360px)' }}
                  />
                </Card>
              ),
            }))}
          />
        </section>
      </section>

      <Modal
        destroyOnClose
        onCancel={() => setEditorState(null)}
        onOk={() => void form.submit()}
        okText={editorState?.mode === 'edit' ? '保存修改' : '创建资源'}
        confirmLoading={saving}
        open={Boolean(editorState)}
        title={editorState?.mode === 'edit' ? '编辑路由资源' : '新建路由资源'}
        width={860}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          requiredMark={false}
        >
          <div
            style={{
              display: 'grid',
              gap: '0 16px',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            }}
          >
            <Form.Item style={{ gridColumn: '1 / -1' }} label="父级节点" name="parentId">
              <Select
                allowClear
                options={parentOptions}
                placeholder="根节点可留空"
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>

            <Form.Item label="资源名称" name="name" rules={[{ required: true, message: '请输入资源名称' }]}>
              <Input maxLength={64} placeholder="例如：路由管理" />
            </Form.Item>

            <Form.Item label="资源标识" name="resourceKey" rules={[{ required: true, message: '请输入资源标识' }]}>
              <Input maxLength={128} placeholder="例如：admin.system.route_resources" />
            </Form.Item>

            <Form.Item label="资源类型" name="resourceType" rules={[{ required: true, message: '请选择资源类型' }]}>
              <Select options={resourceTypeOptions} />
            </Form.Item>

            <Form.Item label="所属平台" name="platform" rules={[{ required: true, message: '请选择平台' }]}>
              <Select options={platformOptions} disabled />
            </Form.Item>

            <Form.Item label="路由路径" name="path">
              <Input maxLength={128} placeholder="例如：/system/routes" />
            </Form.Item>

            <Form.Item label="权限编码" name="permissionCode" rules={[{ required: true, message: '请输入权限编码' }]}>
              <Input maxLength={160} placeholder="例如：admin.route.system.route_resources.view" />
            </Form.Item>

            <Form.Item
              label="菜单可见性"
              name="visibilityMode"
              tooltip="始终显示仅影响菜单入口，页面和接口仍按权限编码校验"
              rules={[{ required: true, message: '请选择菜单可见性' }]}
            >
              <Select options={visibilityModeOptions} />
            </Form.Item>

            <Form.Item label="排序" name="sortOrder">
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label="是否启用" name="status" style={{ gridColumn: '1 / -1' }} valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </ContentStudioLayout>
  );
}
