import { Check } from 'lucide-react';
import { FieldHeading, SwitchRow } from './PromptPlanningPresentational';
import {
  contentTypeOptions,
  durationOptions,
  languageOptions,
  sceneOptions,
  shootingMethodOptions,
  stylePresets,
} from './promptPlanningConfig';
import type { PromptPlanningController } from './usePromptPlanningController';
import './PromptPlanningStepSettings.scss';
import './PromptPlanningChoiceAndBreakdownFields.scss';
import './PromptPlanningSharedFields.scss';
import './PromptPlanningSettingsControls.scss';

type PromptPlanningStepSettingsProps = {
  controller: PromptPlanningController;
};

export function PromptPlanningStepSettings({ controller }: PromptPlanningStepSettingsProps) {
  const { setSettingsDraft, settingsDraft, usesReferencePreset } = controller;

  return (
    <>
      <section className="video-task-epa-settings-section">
        <FieldHeading title="业务场景" subtitle="选填 · 影响话术与结尾引导" />
        <div className="video-task-epa-pill-line">
          {sceneOptions.map((option) => {
            const active = option.value === settingsDraft.businessScene;
            return (
              <button
                aria-pressed={active}
                className={active ? 'is-active' : ''}
                key={option.value}
                onClick={() => setSettingsDraft((current) => ({
                  ...current,
                  businessScene: active ? 'unrestricted' : option.value,
                }))}
                type="button"
              >
                {option.label}
                {active ? <Check aria-hidden="true" size={13} /> : null}
              </button>
            );
          })}
        </div>
      </section>

      {usesReferencePreset ? (
        <section className="video-task-epa-settings-section">
          <FieldHeading title="内容类型 · 拍摄方式" subtitle="" />
          <div className="video-task-epa-locked-note">
            <Check aria-hidden="true" size={15} />
            <span>已由参考视频决定，脚本将参考其结构与镜头，无需手动选择</span>
          </div>
        </section>
      ) : (
        <div className="video-task-epa-manual-preset-stack">
          <section className="video-task-epa-settings-section">
            <FieldHeading title="内容类型" subtitle="必选" />
            <div className="video-task-epa-pill-line is-wrap">
              {contentTypeOptions.map((option) => {
                const active = settingsDraft.contentType === option;
                return (
                  <button
                    aria-pressed={active}
                    className={active ? 'is-active' : ''}
                    key={option}
                    onClick={() => setSettingsDraft((current) => ({ ...current, contentType: option }))}
                    type="button"
                  >
                    {option}
                    {active ? <Check aria-hidden="true" size={13} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="video-task-epa-settings-section">
            <FieldHeading title="拍摄方式" subtitle="必选 · 口播会自动配合词对口型" />
            <div className="video-task-epa-pill-line is-wrap">
              {shootingMethodOptions.map((option) => {
                const active = settingsDraft.shootingMethod === option;
                return (
                  <button
                    aria-pressed={active}
                    className={active ? 'is-active' : ''}
                    key={option}
                    onClick={() => setSettingsDraft((current) => ({ ...current, shootingMethod: option }))}
                    type="button"
                  >
                    {option}
                    {active ? <Check aria-hidden="true" size={13} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <section className="video-task-epa-settings-section">
        <FieldHeading title="口播语言" subtitle="选填 · 只切台词/口播语言，分镜与画面描述仍中文" />
        <div className="video-task-epa-pill-line">
          {languageOptions.map((option) => (
            <button
              aria-pressed={option.value === settingsDraft.spokenLanguage}
              className={option.value === settingsDraft.spokenLanguage ? 'is-active' : ''}
              key={option.value}
              onClick={() => setSettingsDraft((current) => ({ ...current, spokenLanguage: option.value }))}
              type="button"
            >
              {option.label}
              {option.value === settingsDraft.spokenLanguage ? <Check aria-hidden="true" size={13} /> : null}
            </button>
          ))}
        </div>
      </section>

      <SwitchRow
        checked={settingsDraft.displayOnly}
        description="勾选后生成的脚本不带口播台词，仅作视觉展示（自动写入补充说明）"
        label="仅展示"
        onChange={(checked) => setSettingsDraft((current) => ({ ...current, displayOnly: checked }))}
      />

      <section className="video-task-epa-settings-section">
        <FieldHeading title="补充说明" subtitle="可选 · 想强调的开头、卖点、节奏都可以写" />
        <textarea
          className="video-task-epa-large-textarea"
          onChange={(event) => {
            const extraInstruction = event.currentTarget.value;
            setSettingsDraft((current) => ({ ...current, extraInstruction }));
          }}
          placeholder="例如：前 2 秒要有钩子；多给面料和细节特写；结尾自然引导下单。"
          rows={3}
          value={settingsDraft.extraInstruction}
        />
      </section>

      <section className="video-task-epa-settings-section">
        <FieldHeading title="视频时长" subtitle="必选 · 决定镜头分几段" />
        <div className="video-task-epa-pill-line">
          {durationOptions.map((option) => (
            <button
              aria-pressed={option === settingsDraft.durationSeconds}
              className={option === settingsDraft.durationSeconds ? 'is-active' : ''}
              key={option}
              onClick={() => setSettingsDraft((current) => ({ ...current, durationSeconds: option }))}
              type="button"
            >
              {option} 秒
              {option === settingsDraft.durationSeconds ? <Check aria-hidden="true" size={13} /> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="video-task-epa-settings-section">
        <FieldHeading title="视频风格" subtitle="必选" />
        <div className="video-task-epa-pill-line is-wrap">
          {stylePresets.map((style) => {
            const active = settingsDraft.styleKeywords.includes(style);
            return (
              <button
                aria-pressed={active}
                className={active ? 'is-active' : ''}
                key={style}
                onClick={() => setSettingsDraft((current) => ({
                  ...current,
                  styleKeywords: active ? current.styleKeywords.filter((item) => item !== style) : [style],
                }))}
                type="button"
              >
                {style}
                {active ? <Check aria-hidden="true" size={13} /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="video-task-epa-settings-section">
        <FieldHeading title="生成设置" subtitle="选填" />
        <div className="video-task-epa-setting-stack">
          <SwitchRow
            checked={settingsDraft.deepThink}
            description="更懂图、效果更好、生成较慢（约 1-2 分钟）"
            emphasis={settingsDraft.deepThink}
            label="深度思考"
            onChange={(checked) => setSettingsDraft((current) => ({ ...current, deepThink: checked }))}
          />
          <SwitchRow
            checked={settingsDraft.webSearch}
            description="结合实时信息辅助改写，按需开启"
            label="联网搜索"
            onChange={(checked) => setSettingsDraft((current) => ({ ...current, webSearch: checked }))}
          />
        </div>
      </section>
    </>
  );
}
