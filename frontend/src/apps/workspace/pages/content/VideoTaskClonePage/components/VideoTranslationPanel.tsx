import { Select } from 'antd';
import { ArrowRight, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { SelectedMaterials, VideoTranslationConfig, VideoTranslationMode } from '../types';
import { SelectionCardGroup } from './SelectionCardGroup';
import { SubtitleRemovalEditor } from './SubtitleRemovalEditor';
import './VideoTranslationPanel.scss';
import { t } from '@shared/i18n';

const sourceLanguages = [
  { value: 'zh', label: t("中文") },
  { value: 'en', label: t("英语") },
];

const targetLanguages = [
  { value: 'zh', label: t("中文") },
  { value: 'en', label: t("英语") },
  { value: 'ja', label: t("日语") },
  { value: 'ko', label: t("韩语") },
  { value: 'de', label: t("德语") },
  { value: 'fr', label: t("法语") },
  { value: 'ru', label: t("俄语") },
  { value: 'es', label: t("西班牙语") },
  { value: 'pt', label: t("葡萄牙语") },
  { value: 'it', label: t("意大利语") },
  { value: 'id', label: t("印尼语") },
  { value: 'vi', label: t("越南语") },
  { value: 'th', label: t("泰语") },
  { value: 'ar', label: t("阿拉伯语") },
  { value: 'tr', label: t("土耳其语") },
];

type VideoTranslationPanelProps = {
  config: VideoTranslationConfig;
  onChange: (config: VideoTranslationConfig) => void;
  selectedMaterials: SelectedMaterials;
};

export function VideoTranslationPanel({ config, onChange, selectedMaterials }: VideoTranslationPanelProps) {
  const [placementEditorOpen, setPlacementEditorOpen] = useState(false);
  const subtitleLocation = config.subtitlePlacementConfig.locations[0];
  const subtitleBottomMargin = subtitleLocation
    ? Math.round((1 - subtitleLocation.bottomRightY) * 100)
    : null;
  const hasSourceVideo = Boolean(selectedMaterials.video);

  const toggleMode = (mode: Exclude<VideoTranslationMode, 'subtitle'>) => {
    const nextModes = mode === 'voice' && config.modes.voice
      ? { ...config.modes, voice: false, face: false }
      : mode === 'face' && !config.modes.face
        ? { ...config.modes, voice: true, face: true }
        : { ...config.modes, [mode]: !config.modes[mode] };
    onChange({ ...config, modes: nextModes });
  };

  const canSwapLanguages = sourceLanguages.some((language) => language.value === config.targetLanguage);
  const changeSourceLanguage = (nextLanguage: string) => {
    onChange({
      ...config,
      sourceLanguage: nextLanguage,
      targetLanguage: nextLanguage === config.targetLanguage ? config.sourceLanguage : config.targetLanguage,
    });
  };
  const swapLanguages = () => {
    if (!canSwapLanguages) return;
    onChange({
      ...config,
      sourceLanguage: config.targetLanguage,
      targetLanguage: config.sourceLanguage,
    });
  };

  return (
    <section className="video-translation-panel" aria-label={t("视频翻译设置")}>
      <div className="video-translation-language-row">
        <LanguageSelect
          label={t("源语言")}
          onChange={changeSourceLanguage}
          options={sourceLanguages}
          value={config.sourceLanguage}
        />
        <button
          aria-label={t("交换源语言和目标语言")}
          className="video-translation-swap"
          disabled={!canSwapLanguages}
          onClick={swapLanguages}
          title={canSwapLanguages ? t("交换语言") : t("该目标语言暂不支持作为源语言")}
          type="button"
        >
          <ArrowRight size={20} />
        </button>
        <LanguageSelect
          label={t("目标语言")}
          onChange={(targetLanguage) => onChange({ ...config, targetLanguage })}
          options={targetLanguages.filter((language) => language.value !== config.sourceLanguage)}
          value={config.targetLanguage}
        />
      </div>

      <fieldset className="video-translation-fieldset">
        <legend>{t("翻译方式")}</legend>
        <SelectionCardGroup
          ariaLabel={t("翻译方式")}
          columns={3}
          options={[
            {
              description: t("提取字幕并翻译为目标语言。"),
              key: 'subtitle',
              onSelect: () => undefined,
              readOnly: true,
              selected: config.modes.subtitle,
              title: t("字幕翻译"),
              tooltip: t("字幕翻译为必选项"),
            },
            {
              description: t("使用原说话人音色进行字幕播报。"),
              key: 'voice',
              onSelect: () => toggleMode('voice'),
              selected: config.modes.voice,
              title: t("语音翻译"),
            },
            {
              badge: 'beta',
              description: t("让说话人面部与翻译后语音对口型同步。"),
              key: 'face',
              onSelect: () => toggleMode('face'),
              selected: config.modes.face,
              title: t("面容翻译"),
            },
          ]}
          selectionMode="multiple"
        />
      </fieldset>

      <fieldset className="video-translation-fieldset">
        <legend>{t("字幕来源")}</legend>
        <SelectionCardGroup
          ariaLabel={t("字幕来源")}
          columns={2}
          options={[
            {
              description: t("识别源视频画面中的字幕文字。"),
              key: 'ocr',
              onSelect: () => onChange({ ...config, subtitleSource: 'ocr' }),
              selected: config.subtitleSource === 'ocr',
              title: t("识别画面文字 (OCR)"),
            },
            {
              description: t("识别源视频语音并转写为字幕。"),
              key: 'asr',
              onSelect: () => onChange({ ...config, subtitleSource: 'asr' }),
              selected: config.subtitleSource === 'asr',
              title: t("自动语音识别 (ASR)"),
            },
          ]}
        />
      </fieldset>

      <fieldset className="video-translation-fieldset">
        <legend>{t("字幕设置")}</legend>
        <div className="video-translation-toggle-row">
          <Toggle
            checked={config.hardSubtitles}
            label={t("开启硬字幕")}
            onChange={(hardSubtitles) => onChange({ ...config, hardSubtitles })}
          />
          <Toggle
            checked={config.eraseOriginalSubtitles}
            label={t("擦除原字幕")}
            onChange={(eraseOriginalSubtitles) => onChange({ ...config, eraseOriginalSubtitles })}
          />
        </div>
      </fieldset>

      <div className={`video-translation-select-row${config.hardSubtitles ? '' : ' is-disabled'}`}>
        <strong>{t("字幕位置")}</strong>
        <button
          className="video-translation-position-button"
          disabled={!config.hardSubtitles || !hasSourceVideo}
          onClick={() => setPlacementEditorOpen(true)}
          title={!hasSourceVideo ? t("请先上传源视频") : t("打开视频编辑器框选字幕位置")}
          type="button"
        >
          <span className="video-translation-position-copy">
            <strong>{t("框选字幕位置")}</strong>
            <small>
              {hasSourceVideo
                ? t("距底部约 {{0}}%", { "0": subtitleBottomMargin ?? 0 })
                : t("请先上传源视频")}
            </small>
          </span>
          <span className="video-translation-set-badge">
            <SlidersHorizontal size={13} />
            {subtitleLocation ? t("已设置") : t("未设置")}
          </span>
        </button>
      </div>

      <div className={`video-translation-font-row${config.hardSubtitles ? '' : ' is-disabled'}`}>
        <span>{t("字号")}</span>
        <Select
          aria-label={t("硬字幕字号")}
          className="video-translation-antd-select is-font-size"
          disabled={!config.hardSubtitles}
          onChange={(fontSize) => onChange({ ...config, fontSize })}
          options={[16, 20, 24, 28, 32, 36, 40].map((size) => ({
            value: size,
            label: String(size),
          }))}
          size="large"
          value={config.fontSize}
        />
      </div>

      <SubtitleRemovalEditor
        config={config.subtitlePlacementConfig}
        onCancel={() => setPlacementEditorOpen(false)}
        onConfirm={(nextConfig) => {
          onChange({
            ...config,
            subtitlePlacementConfig: {
              ...nextConfig,
              mode: 'manual',
              locations: nextConfig.locations.slice(0, 1),
              clipFilter: { mode: 'all', clips: [] },
            },
          });
          setPlacementEditorOpen(false);
        }}
        open={placementEditorOpen}
        purpose="placement"
        selectedMaterials={selectedMaterials}
      />
    </section>
  );
}

type LanguageSelectProps = {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
};

function LanguageSelect({ label, onChange, options, value }: LanguageSelectProps) {
  return (
    <div className="video-translation-language">
      <span>{label}</span>
      <Select
        aria-label={label}
        className="video-translation-antd-select"
        onChange={onChange}
        options={options}
        size="large"
        value={value}
      />
    </div>
  );
}

type ToggleProps = {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

function Toggle({ checked, label, onChange }: ToggleProps) {
  return (
    <label className="video-translation-toggle">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <i aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
