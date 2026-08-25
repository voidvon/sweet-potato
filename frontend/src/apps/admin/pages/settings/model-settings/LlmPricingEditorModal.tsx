import { useEffect, useState } from 'react';
import { Form, Input, InputNumber, Modal, Select, message } from 'antd';
import { createLlmModelPricing, updateLlmModelPricing } from '../../../api/model-config';
import type { LlmModelPricing } from '../../../types';
import { t } from '@shared/i18n';

type LlmPricingEditorModalProps = {
  editingRecord: LlmModelPricing | null;
  onCancel: () => void;
  onSaved: () => void;
  open: boolean;
};

type LlmPricingFormValues = LlmModelPricing;

export function LlmPricingEditorModal({
  editingRecord,
  onCancel,
  onSaved,
  open,
}: LlmPricingEditorModalProps) {
  const [form] = Form.useForm<LlmPricingFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    form.setFieldsValue(editingRecord || {
      id: '',
      provider: '',
      providerName: '',
      model: '',
      displayName: '',
      defaultBaseUrl: '',
      currency: 'USD',
      inputPricePer1M: 0,
      outputPricePer1M: 0,
      cachedInputPricePer1M: 0,
      contextWindowTokens: 0,
      effectiveContextWindowPercent: 95,
      priceSource: 'official-manual',
      priceUpdatedAt: '',
    });
  }, [editingRecord, form, open]);

  async function handleSubmit(values: LlmPricingFormValues) {
    setSaving(true);
    try {
      if (editingRecord) {
        await updateLlmModelPricing(editingRecord.id, {
          ...editingRecord,
          ...values,
          id: editingRecord.id,
        });
      } else {
        await createLlmModelPricing(values);
      }
      message.success(t("LLM 官方价格目录已保存"));
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("LLM 官方价格目录保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      confirmLoading={saving}
      okText={t("保存")}
      cancelText={t("取消")}
      onCancel={onCancel}
      onOk={() => form.submit()}
      open={open}
      title={editingRecord ? t("编辑 LLM 官方价格") : t("新增 LLM 官方价格")}
      width={760}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
        <div className="antd-form-grid">
          <Form.Item
            label={t("目录 ID")}
            name="id"
            rules={[{ required: true, message: t("请输入目录 ID") }]}
          >
            <Input disabled={Boolean(editingRecord)} placeholder="openai:gpt-4.1-mini" />
          </Form.Item>
          <Form.Item
            label={t("币种")}
            name="currency"
            rules={[{ required: true, message: t("请选择币种") }]}
          >
            <Select
              options={[
                { label: t("美元 USD"), value: 'USD' },
                { label: t("人民币 CNY"), value: 'CNY' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Provider"
            name="provider"
            rules={[{ required: true, message: t("请输入 Provider") }]}
          >
            <Input placeholder={t("openai / deepseek / 火山引擎")} />
          </Form.Item>
          <Form.Item
            label={t("服务商显示名")}
            name="providerName"
            rules={[{ required: true, message: t("请输入服务商显示名") }]}
          >
            <Input placeholder={t("OpenAI / DeepSeek / 火山方舟")} />
          </Form.Item>
          <Form.Item
            label={t("模型名称")}
            name="model"
            rules={[{ required: true, message: t("请输入模型名称") }]}
          >
            <Input placeholder="gpt-4.1-mini" />
          </Form.Item>
          <Form.Item
            label={t("显示名称")}
            name="displayName"
            rules={[{ required: true, message: t("请输入显示名称") }]}
          >
            <Input placeholder="GPT-4.1 Mini" />
          </Form.Item>
          <Form.Item
            className="full-span"
            label={t("默认 Base URL")}
            name="defaultBaseUrl"
            rules={[{ required: true, message: t("请输入默认 Base URL") }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            label={t("输入价格")}
            name="inputPricePer1M"
            rules={[{ required: true, message: t("请输入输入价格") }]}
          >
            <InputNumber min={0} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={t("补全价格")}
            name="outputPricePer1M"
            rules={[{ required: true, message: t("请输入补全价格") }]}
          >
            <InputNumber min={0} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={t("缓存价格")}
            name="cachedInputPricePer1M"
            rules={[{ required: true, message: t("请输入缓存价格") }]}
          >
            <InputNumber min={0} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            extra={t("填写应用默认采用的上下文窗口；0 表示未知，可小于模型公开上限。")}
            label={t("上下文窗口 (Token)")}
            name="contextWindowTokens"
            rules={[{ required: true, message: t("请输入上下文窗口") }]}
          >
            <InputNumber min={0} precision={0} step={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            extra={t("为系统提示词、工具和模型输出预留空间，Codex 默认采用 95%。")}
            label={t("有效上下文比例 (%)")}
            name="effectiveContextWindowPercent"
            rules={[{ required: true, message: t("请输入有效上下文比例") }]}
          >
            <InputNumber min={1} max={100} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={t("价格来源")}
            name="priceSource"
            rules={[{ required: true, message: t("请输入价格来源") }]}
          >
            <Input placeholder="openai-official" />
          </Form.Item>
          <Form.Item
            label={t("价格更新时间")}
            name="priceUpdatedAt"
            rules={[{ required: true, message: t("请输入价格更新时间") }]}
          >
            <Input placeholder="2026-06-15" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
