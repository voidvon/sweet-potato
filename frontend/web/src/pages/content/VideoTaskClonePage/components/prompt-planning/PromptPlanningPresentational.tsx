import { LoaderCircle, Music4, X } from 'lucide-react';
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanningGeneration } from '../../../../../api/content-planning';
import type { LocalMaterialFile } from '../../types';
import { normalizeTagToken } from './planningSessionHelpers';
import './PromptPlanningAudioReferenceCard.scss';
import './PromptPlanningChoiceAndBreakdownFields.scss';
import './PromptPlanningEditableAnalysis.scss';
import './PromptPlanningLoadingCards.scss';
import './PromptPlanningMotion.scss';
import './PromptPlanningSettingsControls.scss';
import './PromptPlanningSharedFields.scss';
import './PromptPlanningPresentational.scss';

type PlanningStageItem = {
  role: string;
  shortLabel: string;
};

export function FieldHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="video-task-epa-field-head">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

export function BreakdownLine({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <div className="video-task-epa-breakdown-line">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

export function BreakdownTagLine({
  label,
  tags,
  tone,
}: {
  label: string;
  tags: string[];
  tone: 'gray' | 'green';
}) {
  if (!tags.length) {
    return null;
  }
  return (
    <div className="video-task-epa-breakdown-line">
      <span>{label}</span>
      <div className={`video-task-epa-tag-group is-${tone}`}>
        {tags.map((tag) => (
          <em key={tag}>{tag}</em>
        ))}
      </div>
    </div>
  );
}

export function EditableTagField({
  label,
  onChange,
  placeholder,
  values,
}: {
  label: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  const [draft, setDraft] = useState('');

  const commitDraft = () => {
    const next = normalizeTagToken(draft);
    if (!next) {
      setDraft('');
      return;
    }
    if (values.includes(next)) {
      setDraft('');
      return;
    }
    onChange([...values, next]);
    setDraft('');
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      commitDraft();
    }
  };

  return (
    <div className="video-task-epa-tag-field">
      <span>{label}</span>
      <div className="video-task-epa-tag-list">
        {values.map((value) => (
          <button
            className="video-task-epa-tag-chip"
            aria-label={`删除${value}`}
            key={value}
            onClick={() => onChange(values.filter((item) => item !== value))}
            type="button"
          >
            <span>{value}</span>
            <X aria-hidden="true" size={12} />
          </button>
        ))}
      </div>
      <input
        className="video-task-epa-tag-add-input"
        onBlur={commitDraft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        type="text"
        value={draft}
      />
    </div>
  );
}

export function SwitchRow({
  checked,
  description,
  emphasis = false,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  emphasis?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`video-task-epa-switch-row`}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <div className={`video-task-epa-switch${checked ? ' is-checked' : ''}`}>
        <span />
      </div>
      <div className="video-task-epa-switch-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
    </button>
  );
}

export function CenteredLoadingCard({
  description,
  progress,
  title,
}: {
  description: string;
  progress: number;
  title: string;
}) {
  return (
    <div className="video-task-epa-loading-shell">
      <div className="video-task-epa-loading-card">
        <div className="video-task-epa-loading-copy">
          <LoaderCircle className="is-spinning" size={18} />
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        </div>
        <div className="video-task-epa-loading-progress">
          {/* <span style={{ width: `${Math.max(progress * 100, 12)}%` }} /> */}
        </div>
      </div>
    </div>
  );
}

export function WideLoadingCard({
  description,
  progress,
  showStages,
  stageItems,
  stages,
  title,
}: {
  description: string;
  progress: number;
  showStages: boolean;
  stageItems: PlanningStageItem[];
  stages: PlanningGeneration['stages'];
  title: string;
}) {
  return (
    <div className="video-task-epa-wide-loading">
      <div className="video-task-epa-loading-copy">
        <LoaderCircle className="is-spinning" size={18} />
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </div>
      <div className="video-task-epa-loading-progress">
        {/* <span style={{ width: `${Math.max(progress * 100, 12)}%` }} /> */}
      </div>
      {showStages ? (
        <div className="video-task-epa-stage-strip">
          {stageItems.map((stage) => {
            const current = stages.find((item) => item.role === stage.role);
            const status = current?.status || 'pending';
            return (
              <span className={`video-task-epa-stage-pill is-${status}`} key={stage.role}>
                {stage.shortLabel}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AudioReferenceCard({
  file,
  isPlaying,
  onPlayToggle,
  onRemove,
  onReplace,
}: {
  file: LocalMaterialFile;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const duration = Number.isFinite(file.audioDuration) && file.audioDuration ? `${Math.round(file.audioDuration)}s` : '音频';

  return (
    <div className="video-task-epa-audio-card">
      <button
        aria-label={isPlaying ? '暂停参考音色' : '试听参考音色'}
        className="video-task-epa-audio-play"
        onClick={onPlayToggle}
        type="button"
      >
        <Music4 aria-hidden="true" size={20} />
      </button>
      <div className="video-task-epa-audio-info">
        <strong title={file.name}>{file.name}</strong>
        <span>{isPlaying ? '播放中' : duration}</span>
      </div>
      <div className="video-task-reference-actions">
        <button onClick={onPlayToggle} type="button">{isPlaying ? '暂停' : '试听'}</button>
        <button onClick={onReplace} type="button">换一段</button>
        <button className="is-danger" onClick={onRemove} type="button">移除</button>
      </div>
    </div>
  );
}
