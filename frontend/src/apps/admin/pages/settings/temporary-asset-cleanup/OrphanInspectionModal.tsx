import { DeleteOutlined } from '@ant-design/icons';
import { Button, Modal, Popconfirm, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import type { OrphanContentFileInspection } from '../../../api/content-cleanup';
import { formatDateTime, formatFileSize, orphanFilePreviewUrl } from './cleanupFormatters';
import { t } from '@shared/i18n';

type OrphanFile = OrphanContentFileInspection['items'][number];

type OrphanInspectionModalProps = {
  deleting: boolean;
  inspection: OrphanContentFileInspection | null;
  selectedPaths: string[];
  onClose: () => void;
  onDelete: (paths: string[]) => void;
  onSelectionChange: (paths: string[]) => void;
};

export function OrphanInspectionModal({
  deleting,
  inspection,
  selectedPaths,
  onClose,
  onDelete,
  onSelectionChange,
}: OrphanInspectionModalProps) {
  const columns = useMemo<ColumnsType<OrphanFile>>(() => [
    {
      title: t("文件名称"),
      dataIndex: 'relativePath',
      ellipsis: true,
      render: (relativePath: string) => (
        <Typography.Link href={orphanFilePreviewUrl(relativePath)} rel="noreferrer" target="_blank">
          {relativePath}
        </Typography.Link>
      ),
    },
    { title: t("大小"), dataIndex: 'size', align: 'right', width: 110, render: formatFileSize },
    { title: t("修改时间"), dataIndex: 'modifiedAt', width: 180, render: formatDateTime },
    {
      title: t("操作"),
      key: 'actions',
      align: 'center',
      width: 72,
      render: (_, record) => (
        <Popconfirm
          cancelText={t("取消")}
          okButtonProps={{ danger: true }}
          okText={t("删除")}
          onConfirm={() => onDelete([record.relativePath])}
          title={t("确认删除此孤立文件？删除后不可恢复。")}
        >
          <Button
            aria-label={t("删除 {{0}}", { "0": record.relativePath })}
            danger
            icon={<DeleteOutlined />}
            loading={deleting}
            title={t("删除")}
            type="text"
          />
        </Popconfirm>
      ),
    },
  ], [deleting, onDelete]);

  return (
    <Modal
      centered
      className="orphan-file-inspection-modal"
      closable={!deleting}
      footer={<Button disabled={deleting} onClick={onClose}>{t("关闭")}</Button>}
      maskClosable={!deleting}
      onCancel={() => {
        if (!deleting) onClose();
      }}
      open={Boolean(inspection)}
      title={t("孤立文件检查结果")}
      width={900}
    >
      {inspection ? (
        <div>
          <Typography.Paragraph>
            {t("共扫描")} <strong>{inspection.scannedFiles}</strong> {t("个文件，发现疑似孤立文件")} <strong>{inspection.orphanFiles}</strong> {t("个， 占用空间")} <strong>{formatFileSize(inspection.orphanBytes)}</strong>。
          </Typography.Paragraph>
          <div className="orphan-file-actions">
            <Popconfirm
              cancelText={t("取消")}
              okButtonProps={{ danger: true }}
              okText={t("删除")}
              onConfirm={() => onDelete(selectedPaths)}
              title={t("确认删除选中的 {{0}} 个孤立文件？删除后不可恢复。", { "0": selectedPaths.length })}
            >
              <Button danger disabled={!selectedPaths.length} icon={<DeleteOutlined />} loading={deleting}>
                {t("删除所选")}{selectedPaths.length ? ` (${selectedPaths.length})` : ''}
              </Button>
            </Popconfirm>
          </div>
          <Table
            columns={columns}
            dataSource={inspection.items}
            loading={deleting}
            pagination={false}
            rowKey="relativePath"
            rowSelection={{
              selectedRowKeys: selectedPaths,
              onChange: (selectedRowKeys) => onSelectionChange(selectedRowKeys.map(String)),
              getCheckboxProps: () => ({ disabled: deleting }),
            }}
            scroll={{ x: 760, y: 400 }}
            size="small"
          />
          {inspection.truncated ? (
            <Typography.Paragraph className="orphan-file-truncated" type="secondary">
              {t("结果较多，仅展示体积最大的前 500 个文件。")}
            </Typography.Paragraph>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
