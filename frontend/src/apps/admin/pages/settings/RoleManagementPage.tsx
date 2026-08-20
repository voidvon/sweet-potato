import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Popconfirm, Space, Table, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { getRouteResourceTree } from '../../api/route-resource';
import { createRole, deleteRole, listRoles, updateRole } from '../../api/role';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type {
  ManagedRole,
  ManagedRouteResource,
  RoleCreatePayload,
  RoleUpdatePayload,
  RouteResourcePlatform,
} from '../../types';
import { RoleEditorModal } from './role-management/RoleEditorModal';
import { normalizeRole, type RoleEditorState } from './role-management/roleManagementHelpers';
import { flattenRouteResources, normalizeRouteResourceList } from './route-resource-shared/routeResourceNormalize';
import { t } from '@shared/i18n';

export function RoleManagementPage() {
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [resourceTree, setResourceTree] = useState<ManagedRouteResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<RoleEditorState | null>(null);
  const [resourceLoadError, setResourceLoadError] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<RouteResourcePlatform>('web');

  const resourceById = useMemo(
    () => new Map(flattenRouteResources(resourceTree).map((resource) => [resource.resourceKey, resource] as const)),
    [resourceTree],
  );

  async function loadPageData() {
    setLoading(true);
    setResourceLoadError(null);
    try {
      const [nextRoles, nextResources] = await Promise.all([
        listRoles().then((items) => items.map(normalizeRole)),
        getRouteResourceTree({ includeDisabled: true }).then(normalizeRouteResourceList),
      ]);
      setRoles(nextRoles);
      setResourceTree(nextResources);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : t("角色数据加载失败");
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

  async function handleSubmit(payload: RoleCreatePayload | RoleUpdatePayload) {
    if (resourceTree.length === 0) {
      message.warning(t("缺少可分配资源树，请先完成 route-resource 后端接口。"));
      return;
    }
    setSaving(true);
    try {
      if (editorState?.mode === 'create') {
        await createRole(payload);
        message.success(t("角色已创建"));
      } else if (editorState?.role) {
        await updateRole(editorState.role.id, payload);
        message.success(t("角色已更新"));
      }
      setEditorState(null);
      await loadPageData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("角色保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: ManagedRole) {
    setDeletingRoleId(role.id);
    try {
      await deleteRole(role.id);
      message.success(t("角色已删除"));
      await loadPageData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("角色删除失败"));
    } finally {
      setDeletingRoleId(null);
    }
  }

  const columns: TableProps<ManagedRole>['columns'] = [
    {
      title: t("角色名称"),
      dataIndex: 'name',
      width: 240,
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <strong>{value}</strong>
            {record.isDefault ? <Tag color="blue">{t("默认角色")}</Tag> : null}
            {record.isSystem ? <Tag color="gold">{t("系统角色")}</Tag> : null}
          </Space>
        </Space>
      ),
    },
    { title: t("说明"), dataIndex: 'description', render: (value?: string | null) => value?.trim() || t("未填写") },
    { title: t("资源数"), width: 120, render: (_value, record) => t("{{0}} 项", { "0": record.grantedResourceIds?.length || 0 }) },
    { title: t("已分配账号"), width: 140, render: (_value, record) => t("{{0}} 人", { "0": record.assignedUserCount ?? 0 }) },
    {
      title: t("授权预览"),
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
            {previewItems.slice(0, 5).map((item) => <Tag key={item.key}>{item.label}</Tag>)}
            {previewItems.length > 5 ? <Tag>+{previewItems.length - 5}</Tag> : null}
            {previewItems.length === 0 ? <Tag>{t("未配置")}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: t("操作"),
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_value, record) => {
        const deleteDisabled = Boolean(record.isSystem) || (record.assignedUserCount ?? 0) > 0;
        return (
          <Space wrap>
            <Button onClick={() => setEditorState({ mode: 'edit', role: record })}>{t("编辑")}</Button>
            <Popconfirm
              title={t("确认删除该角色吗？")}
              description={deleteDisabled
                ? record.isSystem ? t("系统角色不允许删除") : t("请先解除账号绑定后再删除")
                : t("删除后无法恢复，请确认该角色已不再使用。")}
              okButtonProps={{ danger: true }}
              okText={t("删除")}
              cancelText={t("取消")}
              disabled={deleteDisabled}
              onConfirm={() => void handleDelete(record)}
            >
              <Button danger disabled={deleteDisabled} loading={deletingRoleId === record.id}>{t("删除")}</Button>
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
          <p>{t("维护可分配的业务角色，可配置资源树分配 Web / Admin 菜单权限。")}</p>
        </section>
        {resourceLoadError ? (
          <Alert showIcon type="warning" message={t("资源树接口尚未就绪")} description={resourceLoadError} style={{ marginBottom: 16 }} />
        ) : null}
        <section className="settings-section">
          <div className="settings-section-actions">
            <Space size={12}>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadPageData()}>{t("刷新")}</Button>
              <Button
                disabled={resourceTree.length === 0}
                icon={<PlusOutlined />}
                onClick={() => setEditorState({ mode: 'create', role: null })}
                type="primary"
              >
                {t("新建角色")}
              </Button>
            </Space>
          </div>
          <Table
            columns={columns}
            dataSource={roles}
            loading={loading}
            rowKey="id"
            pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => t("共 {{0}} 个角色", { "0": total }) }}
            scroll={{ x: 1380 }}
          />
        </section>
      </section>
      <RoleEditorModal
        activePlatform={activePlatform}
        editorState={editorState}
        onClose={() => setEditorState(null)}
        onPlatformChange={setActivePlatform}
        onSave={(payload) => void handleSubmit(payload)}
        resources={resourceTree}
        saving={saving}
      />
    </ContentStudioLayout>
  );
}
