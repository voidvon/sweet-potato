import { CaretDownOutlined, CaretRightOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Popconfirm, Space, Switch, Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { RouteResourceVisibilityMode } from '../../../types';
import type { RouteResourceRecord } from '../route-resource-shared/routeResourceNormalize';
import { resourceTypeMeta } from '../route-resource-shared/routeResourceTree';
import { t } from '@shared/i18n';

type RouteResourceTableProps = {
  data: RouteResourceRecord[];
  deletingResourceId: string | null;
  loading: boolean;
  onCreateChild: (record: RouteResourceRecord) => void;
  onDelete: (record: RouteResourceRecord) => void;
  onEdit: (record: RouteResourceRecord) => void;
  onToggle: (record: RouteResourceRecord, value: boolean) => void;
};

export function RouteResourceTable({
  data,
  deletingResourceId,
  loading,
  onCreateChild,
  onDelete,
  onEdit,
  onToggle,
}: RouteResourceTableProps) {
  const columns = useMemo<TableProps<RouteResourceRecord>['columns']>(() => [
    {
      title: t("资源节点"),
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
            {record.parentId ? <Tag color="blue">{t("子级")}</Tag> : null}
            {record.isSystem ? <Tag color="gold">{t("系统")}</Tag> : null}
          </Space>
          <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>{record.resourceKey}</span>
        </Space>
      ),
    },
    {
      title: t("类型"),
      width: 110,
      render: (_value, record) => {
        const typeMeta = resourceTypeMeta(record.resourceType);
        return <Tag color={typeMeta.color}>{typeMeta.text}</Tag>;
      },
    },
    { title: t("路径"), width: 240, render: (_value, record) => record.path || t("未配置") },
    { title: t("权限标识"), dataIndex: 'permissionCode', width: 260, render: (value: string) => <Tag>{value || t("未配置")}</Tag> },
    {
      title: t("菜单可见性"),
      dataIndex: 'visibilityMode',
      width: 130,
      render: (value: RouteResourceVisibilityMode) => value === 'always' ? <Tag color="green">{t("始终显示")}</Tag> : <Tag>{t("按权限显示")}</Tag>,
    },
    { title: t("排序"), dataIndex: 'sortOrder', width: 90, render: (value?: number) => value ?? 0 },
    {
      title: t("启用"),
      width: 90,
      render: (_value, record) => <Switch checked={record.status ?? true} onChange={(value) => onToggle(record, value)} />,
    },
    {
      title: t("操作"),
      width: 240,
      render: (_value, record) => {
        const deleteDisabled = Boolean(record.isSystem) || (record.children?.length || 0) > 0;
        return (
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => onCreateChild(record)}>{t("新增下级")}</Button>
            <Button icon={<EditOutlined />} onClick={() => onEdit(record)}>{t("编辑")}</Button>
            <Popconfirm
              title={t("确认删除该路由资源吗？")}
              description={deleteDisabled
                ? record.isSystem ? t("系统资源不允许删除") : t("请先删除或迁移子节点后再删除")
                : t("删除后角色授权会同步失效，请确认不再使用。")}
              okText={t("删除")}
              cancelText={t("取消")}
              okButtonProps={{ danger: true }}
              disabled={deleteDisabled}
              onConfirm={() => onDelete(record)}
            >
              <Button danger disabled={deleteDisabled} loading={deletingResourceId === record.id}>{t("删除")}</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ], [deletingResourceId, onCreateChild, onDelete, onEdit, onToggle]);

  return (
    <Card className="route-resource-table-card">
      <Table
        className="route-resource-table"
        columns={columns}
        dataSource={data}
        expandable={{
          expandIcon: ({ expanded, onExpand, record }) => record.children?.length ? (
            <button
              aria-label={expanded ? t("收起下级资源") : t("展开下级资源")}
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
          ) : null,
        }}
        loading={loading}
        pagination={false}
        rowKey="id"
        scroll={{ x: 1100, y: 'calc(100vh - 360px)' }}
      />
    </Card>
  );
}
