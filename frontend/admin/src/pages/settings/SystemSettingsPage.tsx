import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Flex, Form, Input, InputNumber, Radio, Row, Space, Switch, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import {
  getBatchRequestSettings,
  getFileStorageSettings,
  getIpBlacklistSettings,
  getRateLimitSettings,
  type RateLimitRule,
  updateBatchRequestSettings,
  updateFileStorageSettings,
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
  objectStorageEnabled: boolean;
  objectStorageEndpoint: string;
  objectStorageBucket: string;
  objectStorageRegion: string;
  objectStorageAccessKey: string;
  objectStorageSecretKey: string;
  objectStoragePublicBaseUrl: string;
  objectStorageKeyPrefix: string;
};

export function SystemSettingsPage() {
  const [form] = Form.useForm<SystemSettingsForm>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentIp, setCurrentIp] = useState('');
  const [objectStorageSecretConfigured, setObjectStorageSecretConfigured] = useState(false);

  useEffect(() => {
    Promise.all([
      getBatchRequestSettings(),
      getRateLimitSettings(),
      getIpBlacklistSettings(),
      getFileStorageSettings(),
    ])
      .then(([batchSettings, rateSettings, ipSettings, storageSettings]) => {
        form.setFieldsValue({
          batchMaxCount: batchSettings.maxCount,
          batchMaxDuration: batchSettings.maxDurationSeconds,
          batchMaxFileSize: batchSettings.maxFileSizeMb,
          rateRules: rateSettings.rules,
          ipBlacklist: ipSettings.entries.join('\n'),
          objectStorageEnabled: storageSettings.enabled,
          objectStorageEndpoint: storageSettings.endpoint,
          objectStorageBucket: storageSettings.bucket,
          objectStorageRegion: storageSettings.region,
          objectStorageAccessKey: storageSettings.accessKey,
          objectStorageSecretKey: '',
          objectStoragePublicBaseUrl: storageSettings.publicBaseUrl,
          objectStorageKeyPrefix: storageSettings.keyPrefix,
        });
        setCurrentIp(ipSettings.currentIp);
        setObjectStorageSecretConfigured(storageSettings.secretKeyConfigured);
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
    let ipSaved = false;
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
      ipSaved = true;
      const storageSettings = await updateFileStorageSettings({
        enabled: values.objectStorageEnabled,
        endpoint: values.objectStorageEndpoint || '',
        bucket: values.objectStorageBucket || '',
        region: values.objectStorageRegion || '',
        accessKey: values.objectStorageAccessKey || '',
        secretKey: values.objectStorageSecretKey || '',
        publicBaseUrl: values.objectStoragePublicBaseUrl || '',
        keyPrefix: values.objectStorageKeyPrefix || '',
      });
      form.setFieldsValue({
        batchMaxCount: batchSettings.maxCount,
        batchMaxDuration: batchSettings.maxDurationSeconds,
        batchMaxFileSize: batchSettings.maxFileSizeMb,
        rateRules: rateSettings.rules,
        ipBlacklist: ipSettings.entries.join('\n'),
        objectStorageEnabled: storageSettings.enabled,
        objectStorageEndpoint: storageSettings.endpoint,
        objectStorageBucket: storageSettings.bucket,
        objectStorageRegion: storageSettings.region,
        objectStorageAccessKey: storageSettings.accessKey,
        objectStorageSecretKey: '',
        objectStoragePublicBaseUrl: storageSettings.publicBaseUrl,
        objectStorageKeyPrefix: storageSettings.keyPrefix,
      });
      setCurrentIp(ipSettings.currentIp);
      setObjectStorageSecretConfigured(storageSettings.secretKeyConfigured);
      message.success('系统设置已保存并立即生效');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '系统设置保存失败';
      if (ipSaved) {
        message.error(`其他系统设置已保存，但文件存储设置未完成：${errorMessage}`);
        return;
      }
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
            objectStorageEnabled: false,
            objectStorageRegion: 'cn-beijing',
            objectStorageKeyPrefix: 'app-files',
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
          <Card title="文件存储" style={{ marginTop: 18 }}>
            <Typography.Paragraph>
              系统默认使用本地文件系统保存上传文件。需要扩展存储空间时，可以启用火山引擎 TOS 对象存储。
            </Typography.Paragraph>
            <Form.Item label="使用火山引擎 TOS" name="objectStorageEnabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(previous, current) => previous.objectStorageEnabled !== current.objectStorageEnabled}>
              {({ getFieldValue }) => getFieldValue('objectStorageEnabled') ? (
                <Flex vertical gap="middle">
                  <Alert
                    showIcon
                    type="info"
                    message="启用 TOS 不会自动迁移已有文件"
                    description="已有文件仍保留在本地。启用后新上传和新生成的文件将保存到 TOS，历史文件需要另行迁移。"
                  />
                  <Row gutter={16}>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="服务地址（Endpoint）"
                        name="objectStorageEndpoint"
                        rules={[{ required: true, message: '请输入 TOS 服务地址' }]}
                      >
                        <Input placeholder="https://tos-cn-beijing.volces.com" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                      <Form.Item
                        label="存储桶（Bucket）"
                        name="objectStorageBucket"
                        rules={[{ required: true, message: '请输入存储桶名称' }]}
                      >
                        <Input placeholder="bucket-name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                      <Form.Item
                        label="地域（Region）"
                        name="objectStorageRegion"
                        rules={[{ required: true, message: '请输入地区' }]}
                      >
                        <Input placeholder="cn-beijing" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="Access Key ID"
                        name="objectStorageAccessKey"
                        rules={[{ required: true, message: '请输入 Access Key ID' }]}
                      >
                        <Input autoComplete="off" placeholder="Access Key" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="Secret Access Key"
                        name="objectStorageSecretKey"
                        extra={objectStorageSecretConfigured ? '已配置 Secret Access Key，留空表示保持不变。' : undefined}
                        rules={[{ required: !objectStorageSecretConfigured, message: '请输入 Secret Access Key' }]}
                      >
                        <Input.Password autoComplete="new-password" placeholder="Secret Key" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="访问域名"
                        name="objectStoragePublicBaseUrl"
                        extra="可选。已配置 CDN 或自定义域名时填写；留空则使用 TOS 默认访问域名。该域名需要允许外部模型读取素材。"
                      >
                        <Input placeholder="https://bucket.example.com" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="文件路径前缀"
                        name="objectStorageKeyPrefix"
                        extra="所有文件在存储桶中的统一目录前缀。"
                      >
                        <Input placeholder="app-files" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Flex>
              ) : null}
            </Form.Item>
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
