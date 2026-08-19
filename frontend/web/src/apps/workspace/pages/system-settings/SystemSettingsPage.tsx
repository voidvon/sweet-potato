import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Space,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import './SystemSettingsPage.scss';

type RateRule = {
  urlPattern?: string;
  maxRequests?: number;
  intervalSeconds?: number;
  targetUser?: 'all' | 'authenticated' | 'anonymous';
};

type SystemSettingsValues = {
  batchMaxCount?: number;
  batchMaxDuration?: number;
  batchMaxFileSize?: number;
  rateRules?: RateRule[];
  ipBlacklist?: string;
};

export function SystemSettingsPage() {
  const [form] = Form.useForm<SystemSettingsValues>();
  const [saving, setSaving] = useState(false);

  function handleSubmit() {
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      message.info('系统设置界面已就绪，保存功能将在后续版本开放');
    }, 300);
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page system-settings-page">
        <section className="settings-header">
          <Typography.Title level={2}>系统设置</Typography.Title>
          <Typography.Paragraph>配置批量请求、接口访问频率与 IP 黑名单。当前仅提供配置界面，暂未接入实际服务。</Typography.Paragraph>
        </section>

        <Form
          form={form}
          layout="vertical"
          initialValues={{
            batchMaxCount: 20,
            batchMaxDuration: 300,
            batchMaxFileSize: 100,
            rateRules: [{ urlPattern: '/api/.*', maxRequests: 60, intervalSeconds: 60, targetUser: 'all' }],
          }}
          onFinish={handleSubmit}
        >
          <Card title="批量 API 请求" className="system-settings-card">
            <Row gutter={[20, 4]}>
              <Col xs={24} md={8}>
                <Form.Item label="批量请求最大数量" name="batchMaxCount" extra="单次请求允许处理的最大任务数">
                  <InputNumber min={1} precision={0} addonAfter="个" className="system-settings-number" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="最大处理时间" name="batchMaxDuration" extra="超过该时长的请求将被终止">
                  <InputNumber min={1} precision={0} addonAfter="秒" className="system-settings-number" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="最大文件大小" name="batchMaxFileSize" extra="批量上传中单个文件的大小上限">
                  <InputNumber min={1} precision={0} addonAfter="MB" className="system-settings-number" />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card title="限制速率" className="system-settings-card">
            <Typography.Paragraph type="secondary">按 URL 正则匹配不同接口，为每个 IP 设置独立的请求频率限制。</Typography.Paragraph>
            <Form.List name="rateRules">
              {(fields, { add, remove }) => (
                <div className="rate-rule-list">
                  {fields.map((field, index) => (
                    <div className="rate-rule" key={field.key}>
                      <div className="rate-rule-heading">规则 {index + 1}</div>
                      <Row gutter={[16, 0]} align="bottom">
                        <Col xs={24} lg={8}>
                          <Form.Item {...field} label="URL 正则匹配" name={[field.name, 'urlPattern']} rules={[{ required: true, message: '请输入 URL 正则' }]}>
                            <Input placeholder="例如：/api/video/.*" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} lg={4}>
                          <Form.Item {...field} label="每个 IP 最大请求量" name={[field.name, 'maxRequests']}>
                            <InputNumber min={1} precision={0} addonAfter="次" className="system-settings-number" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} lg={4}>
                          <Form.Item {...field} label="间隔秒数" name={[field.name, 'intervalSeconds']}>
                            <InputNumber min={1} precision={0} addonAfter="秒" className="system-settings-number" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} lg={6}>
                          <Form.Item {...field} label="目标用户" name={[field.name, 'targetUser']}>
                            <Radio.Group optionType="button" buttonStyle="solid" options={[{ label: '全部', value: 'all' }, { label: '登录用户', value: 'authenticated' }, { label: '未登录用户', value: 'anonymous' }]} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} lg={2}>
                          <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>删除</Button>
                        </Col>
                      </Row>
                    </div>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ targetUser: 'all', intervalSeconds: 60 })} block>
                    添加限速规则
                  </Button>
                </div>
              )}
            </Form.List>
          </Card>

          <Card title="IP 黑名单" className="system-settings-card">
            <Form.Item label="禁止访问的 IP 地址" name="ipBlacklist" extra="每行填写一个 IPv4、IPv6 地址或 CIDR 网段">
              <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} placeholder={'例如：\n192.168.1.100\n10.0.0.0/24'} />
            </Form.Item>
          </Card>

          <Divider />
          <Space className="system-settings-actions">
            <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>保存设置</Button>
          </Space>
        </Form>
      </section>
    </ContentStudioLayout>
  );
}

