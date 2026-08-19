import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, DatePicker, Form, Input, Select, Space, Typography } from 'antd';
import type { FormInstance } from 'antd';
import type { ManagedFileListFilters } from '../../../api/file-management';

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
          <Input allowClear placeholder="搜索文件名或所属用户" prefix={<SearchOutlined />} style={{ width: 240 }} />
        </Form.Item>
        <Form.Item name="mediaType">
          <Select
            allowClear
            options={[
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '音频', value: 'audio' },
              { label: '文档', value: 'document' },
              { label: '其他', value: 'other' },
            ]}
            placeholder="文件类型"
            style={{ width: 130 }}
          />
        </Form.Item>
        <Form.Item name="lifecycleStatus">
          <Select
            allowClear
            options={[
              { label: '临时', value: 'temporary' },
              { label: '已引用', value: 'retained' },
              { label: '永久', value: 'permanent' },
            ]}
            placeholder="文件状态"
            style={{ width: 130 }}
          />
        </Form.Item>
        <Form.Item name="createdAt"><RangePicker placeholder={['开始日期', '结束日期']} /></Form.Item>
        <Form.Item>
          <Space>
            <Button htmlType="submit" icon={<SearchOutlined />} loading={loading} type="primary">查询</Button>
            <Button onClick={onReset}>重置</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>刷新</Button>
          </Space>
        </Form.Item>
      </Form>
      <Typography.Text className="file-management-summary" type="secondary">{summaryText}</Typography.Text>
    </div>
  );
}
