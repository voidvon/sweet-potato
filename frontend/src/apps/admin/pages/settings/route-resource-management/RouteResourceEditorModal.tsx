import { Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { useEffect } from 'react';
import type {
  ManagedRouteResource,
  RouteResourceMutationPayload,
  RouteResourcePlatform,
  RouteResourceType,
  RouteResourceVisibilityMode,
} from '../../../types';
import { platformOptions, resourceTypeOptions, visibilityModeOptions } from './routeResourceOptions';
import { t } from '@shared/i18n';

export type RouteResourceEditorState = {
  mode: 'create' | 'edit';
  record: ManagedRouteResource | null;
  parent: ManagedRouteResource | null;
};

type RouteResourceFormValues = {
  parentId?: string | null;
  name: string;
  nameEn?: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  path?: string;
  permissionCode: string;
  visibilityMode: RouteResourceVisibilityMode;
  status?: boolean;
  sortOrder?: number;
};

type RouteResourceEditorModalProps = {
  activePlatform: RouteResourcePlatform;
  editorState: RouteResourceEditorState | null;
  parentOptions: Array<{ label: string; value: string }>;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: RouteResourceMutationPayload) => void;
};

function buildMutationPayload(values: RouteResourceFormValues): RouteResourceMutationPayload {
  return {
    parentId: values.parentId || null,
    name: values.name.trim(),
    nameEn: values.nameEn?.trim() || '',
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

export function RouteResourceEditorModal({
  activePlatform,
  editorState,
  parentOptions,
  saving,
  onClose,
  onSave,
}: RouteResourceEditorModalProps) {
  const [form] = Form.useForm<RouteResourceFormValues>();

  useEffect(() => {
    if (!editorState) return;
    const record = editorState.record;
    form.setFieldsValue(record ? {
      parentId: record.parentId || null,
      name: record.name,
      nameEn: record.nameEn || '',
      resourceKey: record.resourceKey,
      resourceType: record.resourceType,
      platform: record.platform,
      path: record.path || '',
      permissionCode: record.permissionCode,
      visibilityMode: record.visibilityMode || 'permission',
      status: record.status ?? true,
      sortOrder: record.sortOrder ?? 0,
    } : {
      parentId: editorState.parent?.id || null,
      name: '',
      nameEn: '',
      resourceKey: '',
      resourceType: editorState.parent ? 'menu' : 'directory',
      platform: editorState.parent?.platform || activePlatform,
      path: '',
      permissionCode: '',
      visibilityMode: 'permission',
      status: true,
      sortOrder: 0,
    });
  }, [activePlatform, editorState, form]);

  return (
    <Modal
      destroyOnClose
      onCancel={onClose}
      onOk={() => void form.submit()}
      okText={editorState?.mode === 'edit' ? t("保存修改") : t("创建资源")}
      confirmLoading={saving}
      open={Boolean(editorState)}
      title={editorState?.mode === 'edit' ? t("编辑路由资源") : t("新建路由资源")}
      width={860}
    >
      <Form form={form} layout="vertical" onFinish={(values) => onSave(buildMutationPayload(values))} requiredMark={false}>
        <div style={{ display: 'grid', gap: '0 16px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Form.Item style={{ gridColumn: '1 / -1' }} label={t("父级节点")} name="parentId">
            <Select allowClear options={parentOptions} placeholder={t("根节点可留空")} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label={t("中文名称")} name="name" rules={[{ required: true, message: t("请输入中文名称") }]}>
            <Input maxLength={64} placeholder={t("例如：路由管理")} />
          </Form.Item>
          <Form.Item label={t("英文名称")} name="nameEn">
            <Input maxLength={64} placeholder={t("例如：Route Management")} />
          </Form.Item>
          <Form.Item label={t("资源标识")} name="resourceKey" rules={[{ required: true, message: t("请输入资源标识") }]}>
            <Input maxLength={128} placeholder={t("例如：admin.system.route_resources")} />
          </Form.Item>
          <Form.Item label={t("资源类型")} name="resourceType" rules={[{ required: true, message: t("请选择资源类型") }]}>
            <Select options={resourceTypeOptions} />
          </Form.Item>
          <Form.Item label={t("所属平台")} name="platform" rules={[{ required: true, message: t("请选择平台") }]}>
            <Select options={platformOptions} disabled />
          </Form.Item>
          <Form.Item label={t("路由路径")} name="path"><Input maxLength={128} placeholder={t("例如：/system/routes")} /></Form.Item>
          <Form.Item label={t("权限编码")} name="permissionCode" rules={[{ required: true, message: t("请输入权限编码") }]}>
            <Input maxLength={160} placeholder={t("例如：admin.route.system.route_resources.view")} />
          </Form.Item>
          <Form.Item
            label={t("菜单可见性")}
            name="visibilityMode"
            tooltip={t("始终显示仅影响菜单入口，页面和接口仍按权限编码校验")}
            rules={[{ required: true, message: t("请选择菜单可见性") }]}
          >
            <Select options={visibilityModeOptions} />
          </Form.Item>
          <Form.Item label={t("排序")} name="sortOrder"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label={t("是否启用")} name="status" style={{ gridColumn: '1 / -1' }} valuePropName="checked"><Switch /></Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
