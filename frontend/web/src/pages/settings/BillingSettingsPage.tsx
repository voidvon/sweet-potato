import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, message } from 'antd';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type { BillingSettings } from '../../types';
import { getBillingSettings, updateBillingSettings } from '../../api/billing';

type BillingFormValues = Pick<
  BillingSettings,
  'videoUploadCreditsPerMb' | 'videoUnderstandingCreditsPer1MTokens'
>;

export function BillingSettingsPage() {
  const [form] = Form.useForm<BillingFormValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadSettings() {
    setLoading(true);
    try {
      const settings = await getBillingSettings();
      form.setFieldsValue({
        videoUploadCreditsPerMb: settings.videoUploadCreditsPerMb,
        videoUnderstandingCreditsPer1MTokens: settings.videoUnderstandingCreditsPer1MTokens,
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分设置加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function handleSubmit(values: BillingFormValues) {
    setSaving(true);
    try {
      await updateBillingSettings(values);
      message.success('积分设置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分设置保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <p>这里维护系统级视频上传按 MB、视频理解按 token 的积分单价。</p>
        </section>

        <Card loading={loading}>
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{
              videoUploadCreditsPerMb: 0,
              videoUnderstandingCreditsPer1MTokens: 0,
            }}
            requiredMark={false}
          >
            <Form.Item
              label="视频上传单价 (Credit / MB)"
              extra="用于 VOD 上传计费，按上传文件实际大小折算积分。"
              name="videoUploadCreditsPerMb"
              rules={[
                { required: true, message: '请输入视频上传单价' },
                {
                  validator: async (_rule, value) => {
                    if (typeof value === 'number' && value >= 0) {
                      return;
                    }
                    throw new Error('视频上传单价不能小于 0');
                  },
                },
              ]}
            >
              <InputNumber min={0} precision={6} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="视频理解单价 (Credit / 1M tokens)"
              extra="按视频理解返回的实际 token 数量直接折算积分。"
              name="videoUnderstandingCreditsPer1MTokens"
              rules={[
                { required: true, message: '请输入视频理解 token 单价' },
                {
                  validator: async (_rule, value) => {
                    if (typeof value === 'number' && value >= 0) {
                      return;
                    }
                    throw new Error('视频理解 token 单价不能小于 0');
                  },
                },
              ]}
            >
              <InputNumber min={0} precision={6} style={{ width: '100%' }} />
            </Form.Item>
            <Button htmlType="submit" loading={saving} type="primary">
              保存设置
            </Button>
          </Form>
        </Card>
      </section>
    </ContentStudioLayout>
  );
}
