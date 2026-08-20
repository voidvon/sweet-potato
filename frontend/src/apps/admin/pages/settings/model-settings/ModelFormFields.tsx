import {
  AutoComplete,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Table,
} from 'antd';
import type { FormInstance, TableProps } from 'antd';
import type {
  AudioModelProviderOption,
  VideoModelProviderOption,
} from '../../../api/model-config';
import type {
  LlmBillingSettings,
  ModelConfig,
  ModelType,
} from '../../../types';
import { LlmPriceTableRow, renderLlmPriceLines } from './modelSettingsBilling';
import type { ModelFormValues } from './modelSettingsHelpers';
import { toNumericValue } from './modelSettingsHelpers';
import { t } from '@shared/i18n';

type AudioVideoModelFieldsProps = {
  activeType: ModelType;
  audioProvider?: AudioModelProviderOption;
  editingRecord: ModelConfig;
  videoProvider?: VideoModelProviderOption;
};

export function AudioVideoModelFields({
  activeType,
  audioProvider,
  editingRecord,
  videoProvider,
}: AudioVideoModelFieldsProps) {
  return (
    <div className="audio-model-form">
      <div className="audio-form-section">
        <div className="section-heading">
          <div>
            <h3>{editingRecord.name}</h3>
            <p>
              {activeType === 'audio'
                ? (audioProvider?.description || t("服务端内置音频模型"))
                : (videoProvider?.description || t("服务端内置视频模型"))}
            </p>
          </div>
        </div>
        <Form.Item
          label={activeType === 'audio'
            ? (audioProvider?.keyLabel || 'API Key')
            : (videoProvider?.keyLabel || 'API Key')}
          name="apiKey"
        >
          <Input.Password
            placeholder={activeType === 'audio'
              ? (audioProvider?.keyPlaceholder || t("请输入 API Key"))
              : (videoProvider?.keyPlaceholder || t("请输入 API Key"))}
          />
        </Form.Item>
        {activeType === 'audio' ? (
          <Form.Item
            extra={audioProvider?.baseUrlHelp}
            label={audioProvider?.baseUrlLabel || 'Base URL'}
            name="baseUrl"
          >
            <Input placeholder={audioProvider?.baseUrlPlaceholder || t("请输入 Base URL")} />
          </Form.Item>
        ) : (
          <div className="model-subtext">
            {t("默认 Base URL：")}{videoProvider?.defaultBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3'}
          </div>
        )}
        {activeType === 'audio' ? (
          <>
            <div className="model-subtext">
              {t("这里配置该模型的业务计费参数，所有消耗都会直接按积分口径计算。")}
            </div>
            <Form.Item
              label={t("模型消耗倍率")}
              name={['settings', 'billing', 'multiplier']}
              rules={[{ required: true, message: t("请输入模型消耗倍率") }]}
            >
              <InputNumber controls={false} min={0} precision={2} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t("声音克隆单价 (Credit / 次)")}
              name={['settings', 'billing', 'voiceCloneCredits']}
              rules={[{ required: true, message: t("请输入声音克隆单价") }]}
            >
              <InputNumber min={0} precision={6} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t("语音合成单价 (Credit / 1K 字符)")}
              name={['settings', 'billing', 'speechCreditsPer1kChars']}
              rules={[{ required: true, message: t("请输入语音合成单价") }]}
            >
              <InputNumber min={0} precision={6} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label={t("价格来源备注")}
              name={['settings', 'billing', 'priceSource']}
            >
              <Input placeholder={t("例如：official-manual-2026-06-12")} />
            </Form.Item>
          </>
        ) : (
          <div className="model-subtext">
            {t("视频生成按当前模型、清晰度和生成时长计费，单价在系统计费配置中维护。")}
          </div>
        )}
      </div>
    </div>
  );
}

type StandardModelFieldsProps = {
  activeType: ModelType;
  form: FormInstance<ModelFormValues>;
  imageModelOptions: Array<{ label: string; value: string; disabled?: boolean }>;
  imageProviderOptions: Array<{ label: string; value: string }>;
  onImageProviderChange: (providerId: string) => void;
};

export function StandardModelFields({
  activeType,
  form,
  imageModelOptions,
  imageProviderOptions,
  onImageProviderChange,
}: StandardModelFieldsProps) {
  return (
    <div className="antd-form-grid">
      <Form.Item
        label={t("配置名称")}
        name="name"
        rules={[{ required: true, message: t("请输入配置名称") }]}
      >
        <Input placeholder={t("例如：OpenAI 主力模型")} />
      </Form.Item>
      <Form.Item
        label={t("服务商")}
        name="provider"
        rules={[{ required: true, message: activeType === 'image' ? t("请选择服务商") : t("请输入服务商") }]}
      >
        {activeType === 'image' ? (
          <Select
            options={imageProviderOptions}
            onChange={onImageProviderChange}
            placeholder={t("请选择图片服务商")}
          />
        ) : (
          <Input disabled={activeType === 'llm'} placeholder="openai-images / volcengine-seedream / Runway" />
        )}
      </Form.Item>
      <Form.Item
        label={t("模型名称")}
        name="model"
        rules={[{ required: true, message: t("请输入模型名称") }]}
      >
        {activeType === 'image' ? (
          <AutoComplete
            options={imageModelOptions}
            placeholder={t("请输入或选择图片模型")}
          />
        ) : (
          <Input placeholder={t("gpt-5.6 / doubao-seedream-5-0-260128 / 自定义模型 ID")} />
        )}
      </Form.Item>
      {activeType === 'llm' && (
        <Form.Item label="Temperature" name="temperature">
          <InputNumber max={2} min={0} step={0.1} style={{ width: '100%' }} />
        </Form.Item>
      )}
      <Form.Item
        className="full-span"
        extra={activeType === 'image'
          ? t("OpenAI/火山图片模型填写 API 根地址，不要填写 /images/edits 或 /images/generations；Gemini 图片模型填写到 /v1beta。")
          : undefined}
        label="Base URL"
        name="baseUrl"
        rules={[{ required: true, message: t("请输入 Base URL") }]}
      >
        <Input placeholder="https://api.openai.com/v1" />
      </Form.Item>
      <Form.Item className="full-span" label="API Key" name="apiKey">
        <Input.Password placeholder={t("请输入 API Key")} />
      </Form.Item>
      {activeType === 'llm' && (
        <>
          <div className="full-span model-subtext">
            {t("LLM 计费只允许调整倍率。官方价格固定取自“官方价格管理”，实际扣费按官方价格乘以模型倍率计算。")}
          </div>
          <Form.Item className="full-span llm-price-form-item" shouldUpdate>
            {({ getFieldValue }) => {
              const billing = (getFieldValue(['settings', 'billing']) || {}) as Partial<LlmBillingSettings>;
              const multiplier = toNumericValue(billing.multiplier, 1);
              const llmPriceColumns: TableProps<LlmPriceTableRow>['columns'] = [
                {
                  title: t("倍率"),
                  dataIndex: 'multiplier',
                  width: 100,
                  render: () => (
                    <Form.Item
                      name={['settings', 'billing', 'multiplier']}
                      rules={[{ required: true, message: t("请输入模型消耗倍率") }]}
                      noStyle
                    >
                      <InputNumber controls={false} min={0.01} precision={2} step={0.01} style={{ width: '100%' }} />
                    </Form.Item>
                  ),
                },
                {
                  title: t("官方价格"),
                  dataIndex: 'billing',
                  render: (_, record) => renderLlmPriceLines(record.billing, { official: true }),
                },
                {
                  title: t("扣费价格"),
                  dataIndex: 'actualBilling',
                  render: (_, record) => renderLlmPriceLines(record.billing, { multiplier: record.multiplier }),
                },
              ];

              return (
                <Table<LlmPriceTableRow>
                  className="llm-price-table"
                  columns={llmPriceColumns}
                  dataSource={[{ key: 'pricing', billing, multiplier }]}
                  pagination={false}
                  rowKey="key"
                />
              );
            }}
          </Form.Item>
          <Form.Item
            hidden
            name={['settings', 'billing', 'inputCreditsPer1M']}
            rules={[{ required: true, message: t("请输入输入价格") }]}
          >
            <InputNumber min={0} precision={6} />
          </Form.Item>
          <Form.Item
            hidden
            name={['settings', 'billing', 'outputCreditsPer1M']}
            rules={[{ required: true, message: t("请输入输出价格") }]}
          >
            <InputNumber min={0} precision={6} />
          </Form.Item>
          <Form.Item
            hidden
            name={['settings', 'billing', 'cachedInputCreditsPer1M']}
            rules={[{ required: true, message: t("请输入缓存命中输入价格") }]}
          >
            <InputNumber min={0} precision={6} />
          </Form.Item>
          <Form.Item
            label={t("LLM 请求门槛 (Credit)")}
            extra={t("设置为 0 表示账户积分大于 0 就可以发起请求；设置为 100 表示账户积分必须大于 100 才能请求。")}
            name={['settings', 'billing', 'maxOutputCreditsForReserve']}
            rules={[{ required: true, message: t("请输入 LLM 请求门槛") }]}
          >
            <InputNumber
              min={0}
              precision={2}
              step={0.01}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            className="full-span"
            label={t("官方价格来源")}
            name={['settings', 'billing', 'priceSource']}
          >
            <Input disabled placeholder={t("选择模型后自动从官方价格目录读取")} />
          </Form.Item>
          <Form.Item hidden name={['settings', 'billing', 'priceCurrency']}>
            <Input />
          </Form.Item>
          <Form.Item hidden name={['settings', 'billing', 'priceUpdatedAt']}>
            <Input />
          </Form.Item>
        </>
      )}
      {activeType === 'video' && (
        <Form.Item className="full-span" name={['settings', 'supportsAudioInput']} valuePropName="checked">
          <Checkbox>{t("支持音频输入")}</Checkbox>
        </Form.Item>
      )}
      {activeType === 'image' && (
        <>
          <Form.Item
            className="full-span"
            name={['settings', 'imageGeneration', 'supportsCustomResolution']}
            valuePropName="checked"
          >
            <Checkbox>{t("支持自定义分辨率")}</Checkbox>
          </Form.Item>
          <Form.Item
            label={t("图片生成单价 (Credit / 张)")}
            name={['settings', 'billing', 'creditsPerRequest']}
            rules={[{ required: true, message: t("请输入图片生成单价") }]}
          >
            <InputNumber<number>
              formatter={(value) => (value === undefined || value === null
                ? ''
                : Number(value).toFixed(2))}
              min={0}
              precision={2}
              step={0.01}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            className="full-span"
            label={t("价格来源备注")}
            name={['settings', 'billing', 'priceSource']}
          >
            <Input placeholder={t("例如：official-manual-2026-06-12")} />
          </Form.Item>
        </>
      )}
    </div>
  );
}
