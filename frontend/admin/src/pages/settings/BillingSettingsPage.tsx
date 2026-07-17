import { useEffect, useRef, useState } from 'react';
import { Card, Divider, Form, InputNumber, Select, message } from 'antd';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type { BillingSettings, ModelConfig } from '../../types';
import { getBillingSettings, updateBillingSettings } from '../../api/billing';
import { listModelConfigs } from '../../api/model-config';

type BillingFormValues = Pick<
  BillingSettings,
  | 'seedance2CreditsPerSecond720p'
  | 'seedance2CreditsPerSecond480p'
  | 'seedance2FastCreditsPerSecond720p'
  | 'seedance2FastCreditsPerSecond480p'
  | 'seedance2MiniCreditsPerSecond720p'
  | 'seedance2MiniCreditsPerSecond480p'
  | 'videoUploadCreditsPerMb'
  | 'videoUnderstandingCreditsPer1MTokens'
  | 'contentPlanningAnalysisCreditsPerRequest'
  | 'contentPlanningGenerationCreditsPerRequest'
  | 'marketingVideoCreditsPerRequest'
  | 'marketingVideoStoryboardModelConfigId'
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
  const [imageModels, setImageModels] = useState<Array<ModelConfig & { id: string }>>([]);
  const lastSavedValuesRef = useRef<BillingFormValues | null>(null);
  const saveQueueRef = useRef(Promise.resolve());

  async function loadSettings() {
    setLoading(true);
    try {
      const [settings, models] = await Promise.all([
        getBillingSettings(),
        listModelConfigs('image'),
      ]);
      const availableImageModels = models.filter(
        (model): model is ModelConfig & { id: string } => Boolean(model.id),
      );
      const selectedStoryboardModelId = availableImageModels.some((model) => model.id === settings.marketingVideoStoryboardModelConfigId)
        ? settings.marketingVideoStoryboardModelConfigId
        : availableImageModels.find((model) => model.isDefault)?.id || availableImageModels[0]?.id || '';
      setImageModels(availableImageModels);
      const formValues: BillingFormValues = {
        seedance2CreditsPerSecond720p: settings.seedance2CreditsPerSecond720p,
        seedance2CreditsPerSecond480p: settings.seedance2CreditsPerSecond480p,
        seedance2FastCreditsPerSecond720p: settings.seedance2FastCreditsPerSecond720p,
        seedance2FastCreditsPerSecond480p: settings.seedance2FastCreditsPerSecond480p,
        seedance2MiniCreditsPerSecond720p: settings.seedance2MiniCreditsPerSecond720p,
        seedance2MiniCreditsPerSecond480p: settings.seedance2MiniCreditsPerSecond480p,
        videoUploadCreditsPerMb: settings.videoUploadCreditsPerMb,
        videoUnderstandingCreditsPer1MTokens: settings.videoUnderstandingCreditsPer1MTokens,
        contentPlanningAnalysisCreditsPerRequest: settings.contentPlanningAnalysisCreditsPerRequest,
        contentPlanningGenerationCreditsPerRequest: settings.contentPlanningGenerationCreditsPerRequest,
        marketingVideoCreditsPerRequest: settings.marketingVideoCreditsPerRequest,
        marketingVideoStoryboardModelConfigId: selectedStoryboardModelId,
        videoUpscaleCreditsPerRequest: settings.videoUpscaleCreditsPerRequest,
        subtitleRemovalCreditsPerSecond: settings.subtitleRemovalCreditsPerSecond,
        videoTranslationSubtitleCreditsPerSecond: settings.videoTranslationSubtitleCreditsPerSecond,
        videoTranslationVoiceCreditsPerSecond: settings.videoTranslationVoiceCreditsPerSecond,
        videoTranslationFaceCreditsPerSecond: settings.videoTranslationFaceCreditsPerSecond,
        videoTranslationEraseSourceCreditsPerSecond: settings.videoTranslationEraseSourceCreditsPerSecond,
      };
      form.setFieldsValue(formValues);
      lastSavedValuesRef.current = formValues;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分设置加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function saveValues(values: BillingFormValues) {
    if (JSON.stringify(values) === JSON.stringify(lastSavedValuesRef.current)) {
      return;
    }

    try {
      await updateBillingSettings(values);
      lastSavedValuesRef.current = values;
      message.success('积分设置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分设置保存失败');
    }
  }

  async function handleSave() {
    let values: BillingFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    saveQueueRef.current = saveQueueRef.current.then(() => saveValues(values));
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
            onBlur={(event) => {
              if (!event.target.closest('.ant-select')) {
                void handleSave();
              }
            }}
            initialValues={{
              seedance2CreditsPerSecond720p: 20,
              seedance2CreditsPerSecond480p: 12,
              seedance2FastCreditsPerSecond720p: 18,
              seedance2FastCreditsPerSecond480p: 11,
              seedance2MiniCreditsPerSecond720p: 15,
              seedance2MiniCreditsPerSecond480p: 7,
              videoUploadCreditsPerMb: 0,
              videoUnderstandingCreditsPer1MTokens: 0,
              contentPlanningAnalysisCreditsPerRequest: 2,
              contentPlanningGenerationCreditsPerRequest: 3,
              marketingVideoCreditsPerRequest: 15,
              marketingVideoStoryboardModelConfigId: '',
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
            <Divider orientation="horizontal" titlePlacement="left">视频生成单价</Divider>
            <Form.Item
              label="SeeDance 2.0 · 720p"
              extra="生成 720p 视频时使用的每秒价格。"
              name="seedance2CreditsPerSecond720p"
              rules={[
                { required: true, message: '请输入 SeeDance 2.0 720p 视频每秒价格' },
                { validator: nonNegativePriceValidator('SeeDance 2.0 720p 视频每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="SeeDance 2.0 · 480p"
              extra="生成 480p 视频时使用的每秒价格。"
              name="seedance2CreditsPerSecond480p"
              rules={[
                { required: true, message: '请输入 SeeDance 2.0 480p 视频每秒价格' },
                { validator: nonNegativePriceValidator('SeeDance 2.0 480p 视频每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="SeeDance 2.0 fast · 720p"
              extra="生成 720p 视频时使用的每秒价格。"
              name="seedance2FastCreditsPerSecond720p"
              rules={[
                { required: true, message: '请输入 SeeDance 2.0 fast 720p 视频每秒价格' },
                { validator: nonNegativePriceValidator('SeeDance 2.0 fast 720p 视频每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="SeeDance 2.0 fast · 480p"
              extra="生成 480p 视频时使用的每秒价格。"
              name="seedance2FastCreditsPerSecond480p"
              rules={[
                { required: true, message: '请输入 SeeDance 2.0 fast 480p 视频每秒价格' },
                { validator: nonNegativePriceValidator('SeeDance 2.0 fast 480p 视频每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="SeeDance 2.0 mini · 720p"
              extra="生成 720p 视频时使用的每秒价格。"
              name="seedance2MiniCreditsPerSecond720p"
              rules={[
                { required: true, message: '请输入 SeeDance 2.0 mini 720p 视频每秒价格' },
                { validator: nonNegativePriceValidator('SeeDance 2.0 mini 720p 视频每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="SeeDance 2.0 mini · 480p"
              extra="生成 480p 视频时使用的每秒价格。"
              name="seedance2MiniCreditsPerSecond480p"
              rules={[
                { required: true, message: '请输入 SeeDance 2.0 mini 480p 视频每秒价格' },
                { validator: nonNegativePriceValidator('SeeDance 2.0 mini 480p 视频每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>

            <Divider orientation="horizontal" titlePlacement="left">基础视频服务</Divider>
            <Form.Item
              label="视频上传单价"
              extra="用于 VOD 上传计费，按上传文件实际大小折算积分。"
              name="videoUploadCreditsPerMb"
              rules={[
                { required: true, message: '请输入视频上传单价' },
                { validator: nonNegativePriceValidator('视频上传单价') },
              ]}
            >
              <InputNumber addonAfter="credit / MB" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="视频理解单价"
              extra="按视频理解返回的实际 token 数量直接折算积分。"
              name="videoUnderstandingCreditsPer1MTokens"
              rules={[
                { required: true, message: '请输入视频理解 token 单价' },
                { validator: nonNegativePriceValidator('视频理解 token 单价') },
              ]}
            >
              <InputNumber addonAfter="credit / 1M tokens" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="爆款策划 · 素材识别"
              extra="点击“开始识别”并成功完成素材分析时收取的固定积分。"
              name="contentPlanningAnalysisCreditsPerRequest"
              rules={[
                { required: true, message: '请输入爆款策划素材识别单次价格' },
                { validator: nonNegativePriceValidator('爆款策划素材识别单次价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 次" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="爆款策划 · 脚本生成"
              extra="点击“生成脚本”并成功完成候选脚本生成时收取的固定积分。"
              name="contentPlanningGenerationCreditsPerRequest"
              rules={[
                { required: true, message: '请输入爆款策划脚本生成单次价格' },
                { validator: nonNegativePriceValidator('爆款策划脚本生成单次价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 次" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>

            <Divider orientation="horizontal" titlePlacement="left">营销视频生成</Divider>
            <Form.Item
              label="生成价格"
              extra="提交营销视频生成任务时使用的固定单次价格。"
              name="marketingVideoCreditsPerRequest"
              rules={[
                { required: true, message: '请输入营销视频生成单次价格' },
                { validator: nonNegativePriceValidator('营销视频生成单次价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 次" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="分镜模型"
              extra="用于营销视频分镜图片生成，列表包含所有已配置的图片模型。"
              name="marketingVideoStoryboardModelConfigId"
              rules={[{ required: true, message: '请选择分镜模型' }]}
            >
              <Select
                disabled={imageModels.length === 0}
                onChange={() => void handleSave()}
                options={imageModels.map((model) => ({
                  label: `${model.name} (${model.provider} / ${model.model})`,
                  value: model.id,
                }))}
                placeholder={imageModels.length > 0 ? '请选择图片模型' : '暂无可用图片模型'}
                showSearch
                optionFilterProp="label"
                style={priceInputStyle}
              />
            </Form.Item>

            <Divider orientation="horizontal" titlePlacement="left">视频处理</Divider>
            <Form.Item
              label="视频高清放大"
              extra="固定单次价格，不按视频时长折算。"
              name="videoUpscaleCreditsPerRequest"
              rules={[
                { required: true, message: '请输入视频高清放大单次价格' },
                { validator: nonNegativePriceValidator('视频高清放大单次价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 次" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="字幕擦除"
              extra="按处理成功的输出视频时长计算。"
              name="subtitleRemovalCreditsPerSecond"
              rules={[
                { required: true, message: '请输入字幕擦除每秒价格' },
                { validator: nonNegativePriceValidator('字幕擦除每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>

            <Divider orientation="horizontal" titlePlacement="left">视频翻译</Divider>
            <Form.Item
              label="字幕翻译"
              extra="视频翻译的必选基础价格。"
              name="videoTranslationSubtitleCreditsPerSecond"
              rules={[
                { required: true, message: '请输入字幕翻译每秒价格' },
                { validator: nonNegativePriceValidator('字幕翻译每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="语音翻译"
              extra="启用语音翻译时，在字幕翻译价格上叠加。"
              name="videoTranslationVoiceCreditsPerSecond"
              rules={[
                { required: true, message: '请输入语音翻译每秒价格' },
                { validator: nonNegativePriceValidator('语音翻译每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="面容翻译"
              extra="启用面容翻译时，在字幕和语音翻译价格上叠加。"
              name="videoTranslationFaceCreditsPerSecond"
              rules={[
                { required: true, message: '请输入面容翻译每秒价格' },
                { validator: nonNegativePriceValidator('面容翻译每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
            <Form.Item
              label="擦除原字幕"
              extra="视频翻译开启“擦除原字幕”时叠加。"
              name="videoTranslationEraseSourceCreditsPerSecond"
              rules={[
                { required: true, message: '请输入擦除原字幕每秒价格' },
                { validator: nonNegativePriceValidator('擦除原字幕每秒价格') },
              ]}
            >
              <InputNumber addonAfter="credit / 秒" min={0} precision={6} style={priceInputStyle} />
            </Form.Item>
          </Form>
        </Card>
      </section>
    </ContentStudioLayout>
  );
}
