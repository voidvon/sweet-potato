import { Card, Checkbox, Form, Input, Modal, Space } from 'antd';
import { useEffect } from 'react';
import type { ManagedRouteResource, RouteResourcePlatform } from '../../../types';
import { RolePermissionTabs } from './RolePermissionTabs';
import {
  buildRolePayload,
  resolveRoleSelection,
  type RoleEditorState,
  type RoleFormValues,
} from './roleManagementHelpers';
import { t } from '@shared/i18n';

type RoleEditorModalProps = {
  activePlatform: RouteResourcePlatform;
  editorState: RoleEditorState | null;
  resources: ManagedRouteResource[];
  saving: boolean;
  onClose: () => void;
  onPlatformChange: (platform: RouteResourcePlatform) => void;
  onSave: (payload: ReturnType<typeof buildRolePayload>) => void;
};

export function RoleEditorModal({
  activePlatform,
  editorState,
  resources,
  saving,
  onClose,
  onPlatformChange,
  onSave,
}: RoleEditorModalProps) {
  const [form] = Form.useForm<RoleFormValues>();

  useEffect(() => {
    if (!editorState) return;
    const role = editorState.role;
    form.setFieldsValue(role ? {
      name: role.name,
      description: role.description || '',
      grantedResourceIds: resolveRoleSelection(role),
      isDefault: Boolean(role.isDefault),
    } : {
      name: '',
      description: '',
      grantedResourceIds: [],
      isDefault: false,
    });
  }, [editorState, form]);

  return (
    <Modal
      destroyOnClose
      onCancel={onClose}
      onOk={() => void form.submit()}
      okText={editorState?.mode === 'create' ? t("创建角色") : t("保存修改")}
      confirmLoading={saving}
      open={Boolean(editorState)}
      title={editorState?.mode === 'create' ? t("新建角色") : t("编辑角色")}
      width={920}
    >
      <Form form={form} layout="vertical" onFinish={(values) => onSave(buildRolePayload(values))} requiredMark={false}>
        <Form.Item label={t("角色名称")} name="name" rules={[{ required: true, message: t("请输入角色名称") }]}>
          <Input maxLength={64} placeholder={t("例如：内容运营")} />
        </Form.Item>
        <Form.Item label={t("角色说明")} name="description">
          <Input.TextArea maxLength={200} rows={3} placeholder={t("说明该角色可以访问哪些业务模块")} />
        </Form.Item>
        <Form.Item name="grantedResourceIds" hidden />
        <Card size="small" title={t("资源授权")} styles={{ body: { paddingTop: 8 } }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <RolePermissionTabs
              activePlatform={activePlatform}
              form={form}
              onPlatformChange={onPlatformChange}
              resources={resources}
            />
            <Form.Item name="isDefault" valuePropName="checked"><Checkbox>{t("设为默认角色")}</Checkbox></Form.Item>
          </Space>
        </Card>
      </Form>
    </Modal>
  );
}
