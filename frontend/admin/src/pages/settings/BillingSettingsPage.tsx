import { useEffect, useState } from 'react';
import { Button, Card, Divider, Form, InputNumber, message } from 'antd';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type { BillingSettings } from '../../types';
import { getBillingSettings, updateBillingSettings } from '../../api/billing';

type BillingFormValues = Pick<
  BillingSettings,
  | 'videoUploadCreditsPerMb'
  | 'videoUnderstandingCreditsPer1MTokens'
  | 'videoUpscaleCreditsPerRequest'
  | 'subtitleRemovalCreditsPerSecond'
  | 'videoTranslationSubtitleCreditsPerSecond'
  | 'videoTranslationVoiceCreditsPerSecond'
  | 'videoTranslationFaceCreditsPerSecond'
  | 'videoTranslationEraseSourceCreditsPerSecond'
>;

function nonNegativePriceValidator(label: string) {
  return async (_rule: unknown, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return;
    }
    throw new Error(`${label}不能小于 0`);
  };
}

const priceInputStyle = { width: 240 };

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
        videoUpscaleCreditsPerRequest: settings.videoUpscaleCreditsPerRequest,
        subtitleRemovalCreditsPerSecond: settings.subtitleRemovalCreditsPerSecond,
        videoTranslationSubtitleCreditsPerSecond: settings.videoTranslationSubtitleCreditsPerSecond,
        videoTranslationVoiceCreditsPerSecond: settings.videoTranslationVoiceCreditsPerSecond,
        videoTranslationFaceCreditsPerSecond: settings.videoTranslationFaceCreditsPerSecond,
        videoTranslationEraseSourceCreditsPerSecond: settings.videoTranslationEraseSourceCreditsPerSecond,
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
          <p>这里维护系统级视频处理和 AI 服务的积分单价。</p>
        </section>

        <Card loading={loading}>
          <Form
            form={form}
            labelCol={{ flex: '260px' }}
            labelAlign="left"
            layout="horizontal"
            onFinish={handleSubmit}
            initialValues={{
              videoUploadCreditsPerMb: 0,
              videoUnderstandingCreditsPer1MTokens: 0,
              videoUpscaleCreditsPerRequest: 20,
              subtitleRemovalCreditsPerSecond: 2,
              videoTranslationSubtitleCreditsPerSecond: 1,
              videoTranslationVoiceCreditsPerSecond: 2,
              videoTranslationFaceCreditsPerSecond: 2,
              videoTranslationEraseSourceCreditsPerSecond: 2,
            }}
            requiredMark={false}
            wrapperCol={{ flex: '0 1 440px' }}
          >
            <Divider orientation="horizontal" titlePlacement="left">基础视频服务</Divider>
            <Form.Item
              label="视频上传单价 (Credit / MB)"
              extra="用于 VOD 上传计费，按上传文件实际大小折算积分。"
              name="videoUploadCreditsPerMb"
              rules={[
                { required: true, message: '请输入视频上传单价' },
                { validator: nonNegativePriceValidator('视频上传单价') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="视频理解单价 (Credit / 1M tokens)"
              extra="按视频理解返回的实际 token 数量直接折算积分。"
              name="videoUnderstandingCreditsPer1MTokens"
              rules={[
                { required: true, message: '请输入视频理解 token 单价' },
                { validator: nonNegativePriceValidator('视频理解 token 单价') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>

            <Divider orientation="horizontal" titlePlacement="left">视频处理</Divider>
            <Form.Item
              label="视频高清放大 (Credit / 次)"
              extra="固定单次价格，不按视频时长折算。"
              name="videoUpscaleCreditsPerRequest"
              rules={[
                { required: true, message: '请输入视频高清放大单次价格' },
                { validator: nonNegativePriceValidator('视频高清放大单次价格') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="字幕擦除 (Credit / 秒)"
              extra="按处理成功的输出视频时长计算。"
              name="subtitleRemovalCreditsPerSecond"
              rules={[
                { required: true, message: '请输入字幕擦除每秒价格' },
                { validator: nonNegativePriceValidator('字幕擦除每秒价格') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>

            <Divider orientation="horizontal" titlePlacement="left">视频翻译</Divider>
            <Form.Item
              label="字幕翻译 (Credit / 秒)"
              extra="视频翻译的必选基础价格。"
              name="videoTranslationSubtitleCreditsPerSecond"
              rules={[
                { required: true, message: '请输入字幕翻译每秒价格' },
                { validator: nonNegativePriceValidator('字幕翻译每秒价格') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="语音翻译 (Credit / 秒)"
              extra="启用语音翻译时，在字幕翻译价格上叠加。"
              name="videoTranslationVoiceCreditsPerSecond"
              rules={[
                { required: true, message: '请输入语音翻译每秒价格' },
                { validator: nonNegativePriceValidator('语音翻译每秒价格') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="面容翻译 (Credit / 秒)"
              extra="启用面容翻译时，在字幕和语音翻译价格上叠加。"
              name="videoTranslationFaceCreditsPerSecond"
              rules={[
                { required: true, message: '请输入面容翻译每秒价格' },
                { validator: nonNegativePriceValidator('面容翻译每秒价格') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="擦除原字幕 (Credit / 秒)"
              extra="视频翻译开启“擦除原字幕”时叠加。"
              name="videoTranslationEraseSourceCreditsPerSecond"
              rules={[
                { required: true, message: '请输入擦除原字幕每秒价格' },
                { validator: nonNegativePriceValidator('擦除原字幕每秒价格') },
              ]}
            >
              <InputNumber min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item label={null}>
              <Button htmlType="submit" loading={saving} type="primary">
                保存设置
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </section>
    </ContentStudioLayout>
  );
}
