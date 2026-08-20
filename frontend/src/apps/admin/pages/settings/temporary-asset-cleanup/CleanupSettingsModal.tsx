import { Form, InputNumber, Modal, message } from 'antd';
import { useEffect, useState } from 'react';
import {
  getTemporaryAssetCleanupSettings,
  updateTemporaryAssetCleanupSettings,
  type TemporaryAssetCleanupSettings,
} from '../../../api/content-cleanup';
import { t } from '@shared/i18n';

type CleanupSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function CleanupSettingsModal({ open, onClose, onSaved }: CleanupSettingsModalProps) {
  const [form] = Form.useForm<TemporaryAssetCleanupSettings>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getTemporaryAssetCleanupSettings()
      .then((settings) => form.setFieldsValue(settings))
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : t("清理设置加载失败"));
      });
  }, [form, open]);

  async function save() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateTemporaryAssetCleanupSettings(values);
      message.success(t("临时素材清理设置已保存"));
      onClose();
      onSaved();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      centered
      confirmLoading={saving}
      okText={t("保存设置")}
      onCancel={onClose}
      onOk={() => void save()}
      open={open}
      title={t("临时素材清理设置")}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          extra={t("新产生且未被引用的临时素材将在此时长后进入清理队列。")}
          label={t("临时素材保留时长")}
          name="retentionHours"
          rules={[{ required: true, message: t("请输入保留时长") }, { type: 'number', min: 1, max: 720, message: t("请输入 1-720 小时") }]}
        >
          <InputNumber addonAfter={t("小时")} min={1} max={720} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          extra={t("服务会按此频率检查并清理已过期且未被引用的素材。")}
          label={t("自动清理间隔")}
          name="cleanupIntervalMinutes"
          rules={[{ required: true, message: t("请输入清理间隔") }, { type: 'number', min: 5, max: 1440, message: t("请输入 5-1440 分钟") }]}
        >
          <InputNumber addonAfter={t("分钟")} min={5} max={1440} precision={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
