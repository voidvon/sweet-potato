import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, DatePicker, Form, Input, Select, Space, Typography } from 'antd';
import type { FormInstance } from 'antd';
import type { ManagedFileListFilters } from '../../../api/file-management';
import { t } from '@shared/i18n';

const { RangePicker } = DatePicker;

type DateValue = {
  startOf: (unit: 'day') => DateValue;
  endOf: (unit: 'day') => DateValue;
  toISOString: () => string;
};

export type FileFilterForm = {
  search?: string;
  mediaType?: ManagedFileListFilters['mediaType'];
  lifecycleStatus?: ManagedFileListFilters['lifecycleStatus'];
  createdAt?: [DateValue, DateValue];
};

type FileManagementFiltersProps = {
  form: FormInstance<FileFilterForm>;
  loading: boolean;
  summaryText: string;
  onApply: (values: FileFilterForm) => void;
  onRefresh: () => void;
  onReset: () => void;
};

export function FileManagementFilters({
  form,
  loading,
  summaryText,
  onApply,
  onRefresh,
  onReset,
}: FileManagementFiltersProps) {
  return (
    <div className="file-management-toolbar">
      <Form form={form} layout="inline" onFinish={onApply}>
        <Form.Item name="search">
          <Input allowClear placeholder={t("搜索文件名或所属用户")} prefix={<SearchOutlined />} style={{ width: 240 }} />
        </Form.Item>
        <Form.Item name="mediaType">
          <Select
            allowClear
            options={[
              { label: t("图片"), value: 'image' },
              { label: t("视频"), value: 'video' },
              { label: t("音频"), value: 'audio' },
              { label: t("文档"), value: 'document' },
              { label: t("其他"), value: 'other' },
            ]}
            placeholder={t("文件类型")}
            style={{ width: 130 }}
          />
        </Form.Item>
        <Form.Item name="lifecycleStatus">
          <Select
            allowClear
            options={[
              { label: t("临时"), value: 'temporary' },
              { label: t("已引用"), value: 'retained' },
              { label: t("永久"), value: 'permanent' },
            ]}
            placeholder={t("文件状态")}
            style={{ width: 130 }}
          />
        </Form.Item>
        <Form.Item name="createdAt"><RangePicker placeholder={[t("开始日期"), t("结束日期")]} /></Form.Item>
        <Form.Item>
          <Space>
            <Button htmlType="submit" icon={<SearchOutlined />} loading={loading} type="primary">{t("查询")}</Button>
            <Button onClick={onReset}>{t("重置")}</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>{t("刷新")}</Button>
          </Space>
        </Form.Item>
      </Form>
      <Typography.Text className="file-management-summary" type="secondary">{summaryText}</Typography.Text>
    </div>
  );
}
