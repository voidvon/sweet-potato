import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Space, Tabs, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  createRouteResource,
  deleteRouteResource,
  getRouteResourceTree,
  updateRouteResource,
} from '../../api/route-resource';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type {
  ManagedRouteResource,
  RouteResourceMutationPayload,
  RouteResourcePlatform,
} from '../../types';
import {
  RouteResourceEditorModal,
  type RouteResourceEditorState,
} from './route-resource-management/RouteResourceEditorModal';
import { RouteResourceTable } from './route-resource-management/RouteResourceTable';
import { platformTabs } from './route-resource-management/routeResourceOptions';
import {
  filterRouteResourceTree,
  flattenRouteResources,
  normalizeRouteResourceList,
  type RouteResourceRecord,
} from './route-resource-shared/routeResourceNormalize';
import './RouteResourceManagementPage.scss';

export function RouteResourceManagementPage() {
  const [treeData, setTreeData] = useState<RouteResourceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorState, setEditorState] = useState<RouteResourceEditorState | null>(null);
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<RouteResourcePlatform>('web');
  const [keyword, setKeyword] = useState('');

  const parentOptions = useMemo(
    () => flattenRouteResources(treeData).map((resource) => ({
      label: `${resource.name} · ${resource.resourceKey}`,
      value: resource.id,
    })),
    [treeData],
  );
  const filteredTreeData = useMemo(() => filterRouteResourceTree(treeData, keyword), [keyword, treeData]);

  async function loadResources() {
    setLoading(true);
    try {
      const response = await getRouteResourceTree({ includeDisabled: true, platform: activePlatform });
      setTreeData(normalizeRouteResourceList(response));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '路由资源加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadResources();
  }, [activePlatform]);

  async function handleSave(payload: RouteResourceMutationPayload) {
    setSaving(true);
    try {
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

  async function handleQuickToggle(record: ManagedRouteResource, status: boolean) {
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
        status,
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

  return (
    <ContentStudioLayout>
      <section className="settings-page route-resource-page">
        <section className="settings-header"><p>按 Web / Admin 维护目录和菜单资源</p></section>
        <section className="settings-section">
          <div className="settings-section-actions">
            <Input.Search
              allowClear
              placeholder="搜索名称 / 资源键 / 权限码 / 路径"
              style={{ width: 320 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadResources()}>刷新</Button>
              <Button
                icon={<PlusOutlined />}
                onClick={() => setEditorState({ mode: 'create', parent: null, record: null })}
                type="primary"
              >
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
                <RouteResourceTable
                  data={filteredTreeData}
                  deletingResourceId={deletingResourceId}
                  loading={loading}
                  onCreateChild={(record) => setEditorState({ mode: 'create', parent: record, record: null })}
                  onDelete={(record) => void handleDelete(record)}
                  onEdit={(record) => setEditorState({ mode: 'edit', parent: null, record })}
                  onToggle={(record, status) => void handleQuickToggle(record, status)}
                />
              ),
            }))}
          />
        </section>
      </section>
      <RouteResourceEditorModal
        activePlatform={activePlatform}
        editorState={editorState}
        onClose={() => setEditorState(null)}
        onSave={(payload) => void handleSave(payload)}
        parentOptions={parentOptions}
        saving={saving}
      />
    </ContentStudioLayout>
  );
}
