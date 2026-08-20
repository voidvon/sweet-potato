import { PlusOutlined } from '@ant-design/icons';
import { Button, Modal, Popconfirm, Space, Table } from 'antd';
import type { TableProps } from 'antd';
import type { LlmModelPricing } from '../../../types';
import { renderCompactLlmOfficialPriceLines } from './modelSettingsBilling';
import { t } from '@shared/i18n';

type LlmPricingModalProps = {
  llmModelPricing: LlmModelPricing[];
  onCancel: () => void;
  onDelete: (record: LlmModelPricing) => void;
  onEdit: (record: LlmModelPricing) => void;
  onOpenCreate: () => void;
  open: boolean;
};

export function LlmPricingModal({
  llmModelPricing,
  onCancel,
  onDelete,
  onEdit,
  onOpenCreate,
  open,
}: LlmPricingModalProps) {
  const llmPricingColumns: TableProps<LlmModelPricing>['columns'] = [
    {
      title: t("服务商"),
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <strong>{record.providerName}</strong>
          <span className="model-subtext">{record.provider}</span>
        </Space>
      ),
    },
    {
      title: t("模型"),
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <span>{record.displayName}</span>
          <span className="model-subtext">{record.model}</span>
        </Space>
      ),
    },
    {
      title: t("官方价格"),
      width: 320,
      render: (_, record) => renderCompactLlmOfficialPriceLines(record),
    },
    {
      title: t("操作"),
      width: 180,
      render: (_, record) => (
        <Space>
          <Button onClick={() => onEdit(record)}>{t("编辑")}</Button>
          <Popconfirm
            okText={t("删除")}
            cancelText={t("取消")}
            onConfirm={() => onDelete(record)}
            title={t("确认删除该 LLM 官方价格目录？")}
          >
            <Button danger>{t("删除")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      className="llm-pricing-management-modal"
      footer={null}
      onCancel={onCancel}
      open={open}
      title={t("LLM 官方价格管理")}
      width={1180}
    >
      <div className="llm-pricing-modal-list">
        <div className="model-config-toolbar">
          <div>
            <div className="model-subtext">{t("模型配置和运行时计费都会读取这里的官方价格。")}</div>
          </div>
          <Button icon={<PlusOutlined />} onClick={onOpenCreate} type="primary">
            {t("新增模型价格")}
          </Button>
        </div>
        <Table
          columns={llmPricingColumns}
          dataSource={llmModelPricing}
          tableLayout="fixed"
          pagination={false}
          rowKey={(record) => record.id}
          scroll={{ x: 1040, y: 'calc(80vh - 220px)' }}
        />
      </div>
    </Modal>
  );
}
