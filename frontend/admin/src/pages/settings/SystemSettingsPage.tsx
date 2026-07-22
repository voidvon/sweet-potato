import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Radio, Space, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import {
  getBatchRequestSettings,
  getIpBlacklistSettings,
  getRateLimitSettings,
  type RateLimitRule,
  updateBatchRequestSettings,
  updateIpBlacklistSettings,
  updateRateLimitSettings,
} from '../../api/system-settings';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';

type SystemSettingsForm = {
  batchMaxCount: number;
  batchMaxDuration: number;
  batchMaxFileSize: number;
  rateRules: RateLimitRule[];
  ipBlacklist: string;
};

export function SystemSettingsPage() {
  const [form] = Form.useForm<SystemSettingsForm>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentIp, setCurrentIp] = useState('');

  useEffect(() => {
    Promise.all([
      getBatchRequestSettings(),
      getRateLimitSettings(),
      getIpBlacklistSettings(),
    ])
      .then(([batchSettings, rateSettings, ipSettings]) => {
        form.setFieldsValue({
          batchMaxCount: batchSettings.maxCount,
          batchMaxDuration: batchSettings.maxDurationSeconds,
          batchMaxFileSize: batchSettings.maxFileSizeMb,
          rateRules: rateSettings.rules,
          ipBlacklist: ipSettings.entries.join('\n'),
        });
        setCurrentIp(ipSettings.currentIp);
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '系统设置加载失败'))
      .finally(() => setLoading(false));
  }, [form]);

  async function handleFinish(values: SystemSettingsForm) {
    const entries = String(values.ipBlacklist || '')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    setSaving(true);
    let batchSaved = false;
    let rateSaved = false;
    try {
      const batchSettings = await updateBatchRequestSettings({
        maxCount: values.batchMaxCount,
        maxDurationSeconds: values.batchMaxDuration,
        maxFileSizeMb: values.batchMaxFileSize,
      });
      batchSaved = true;
      const rateSettings = await updateRateLimitSettings(values.rateRules || []);
      rateSaved = true;
      const ipSettings = await updateIpBlacklistSettings(entries);
      form.setFieldsValue({
        batchMaxCount: batchSettings.maxCount,
        batchMaxDuration: batchSettings.maxDurationSeconds,
        batchMaxFileSize: batchSettings.maxFileSizeMb,
        rateRules: rateSettings.rules,
        ipBlacklist: ipSettings.entries.join('\n'),
      });
      setCurrentIp(ipSettings.currentIp);
      message.success('系统设置已保存并立即生效');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '系统设置保存失败';
      if (batchSaved && rateSaved) {
        message.error(`批量 API 请求与限速规则已保存，但 IP 黑名单未完成：${errorMessage}`);
        return;
      }
      if (batchSaved) {
        message.error(`批量 API 请求已保存，但其余设置未完成：${errorMessage}`);
        return;
      }
      message.error(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <Typography.Paragraph>配置批量 API 请求、限制速率与 IP 黑名单。</Typography.Paragraph>
        </section>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          initialValues={{
            batchMaxCount: 20,
            batchMaxDuration: 300,
            batchMaxFileSize: 100,
            rateRules: [{ urlPattern: '/api/.*', maxRequests: 60, intervalSeconds: 60, targetUser: 'all' }],
          }}
        >
          <Card title="批量 API 请求">
            <Space wrap>
              <Form.Item label="批量请求最大数量" name="batchMaxCount"><InputNumber min={1} addonAfter="个" /></Form.Item>
              <Form.Item label="最大处理时间" name="batchMaxDuration"><InputNumber min={1} addonAfter="秒" /></Form.Item>
              <Form.Item label="最大文件大小" name="batchMaxFileSize"><InputNumber min={1} addonAfter="MB" /></Form.Item>
            </Space>
          </Card>
          <Card title="限制速率" style={{ marginTop: 18 }}>
            <Form.List name="rateRules">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field, index) => (
                    <Space key={field.key} wrap align="end" style={{ display: 'flex', marginBottom: 16 }}>
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input type="hidden" />
                      </Form.Item>
                      <Form.Item
                        label={index === 0 ? 'URL 正则匹配' : `规则 ${index + 1} URL`}
                        name={[field.name, 'urlPattern']}
                        rules={[{ required: true, message: '请输入 URL 正则' }]}
                      >
                        <Input placeholder="例如：/api/.*" />
                      </Form.Item>
                      <Form.Item
                        label="每个 IP 最大请求量"
                        name={[field.name, 'maxRequests']}
                        rules={[{ required: true, message: '请输入请求次数' }]}
                      >
                        <InputNumber min={1} addonAfter="次" />
                      </Form.Item>
                      <Form.Item
                        label="间隔秒数"
                        name={[field.name, 'intervalSeconds']}
                        rules={[{ required: true, message: '请输入间隔秒数' }]}
                      >
                        <InputNumber min={1} addonAfter="秒" />
                      </Form.Item>
                      <Form.Item
                        label="目标用户"
                        name={[field.name, 'targetUser']}
                        rules={[{ required: true, message: '请选择目标用户' }]}
                      >
                        <Radio.Group optionType="button" options={[{ label: '全部', value: 'all' }, { label: '登录用户', value: 'authenticated' }, { label: '未登录用户', value: 'anonymous' }]} />
                      </Form.Item>
                      <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => add({ urlPattern: '/api/.*', maxRequests: 60, intervalSeconds: 60, targetUser: 'all' })}
                  >
                    添加限速规则
                  </Button>
                </>
              )}
            </Form.List>
          </Card>
          <Card title="IP 黑名单" style={{ marginTop: 18 }}>
            <Form.Item label="禁止访问的 IP 地址" name="ipBlacklist" extra={`每行填写一个 IP 地址或 CIDR 网段。当前管理端 IP：${currentIp || '读取中'}`}><Input.TextArea rows={5} placeholder={'例如：\n192.168.1.100\n10.0.0.0/24'} disabled={loading} /></Form.Item>
          </Card>
          <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}><Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} disabled={loading}>保存设置</Button></Space>
        </Form>
      </section>
    </ContentStudioLayout>
  );
}
