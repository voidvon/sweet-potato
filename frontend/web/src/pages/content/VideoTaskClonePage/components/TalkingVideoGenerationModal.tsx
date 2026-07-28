import { Button, Dropdown, Modal, Popover, message } from 'antd';
import { ChevronDown, Copy, Layers3, Library, Maximize, Music2, ScanLine, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CreditIcon } from '@shared/components/CreditIcon';
import { modelOptions, qualityOptions, ratioOptions } from '../constants';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';
import type { LocalMaterialFile, MaterialKind, SelectedMaterialValue } from '../types';
import { AudioMaterialStack } from './AudioMaterialStack';
import { AudioAssetLibraryPanel } from './AudioAssetLibraryList';
import type { MediaAttachmentItem } from '../../../../components/MediaAttachmentStack';
import { PromptMentionEditor } from './PromptMentionEditor';
import { PromptModal } from './PromptModal';
import { TalkingVideoImageMaterials } from './TalkingVideoPanel';
import { resolveLocalMaterialUrl } from '../materialUrl';
import './TalkingVideoGenerationModal.scss';

const audioKind: MaterialKind = {
  key: 'audio',
  label: '口播声音',
  hint: '限 1 段，≤ 15 秒',
  maxCount: 1,
  meta: '可选',
};

export function TalkingVideoGenerationModal({ state }: { state: VideoTaskCloneState }) {
  const task = state.talkingVideoPromptTask;
  const [draft, setDraft] = useState(task?.prompt || '');
  const [confirmed, setConfirmed] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const wasOpenRef = useRef(false);
  const promptModified = draft !== task?.prompt;
  const audioFiles = localFiles(state.talkingVideoGenerationMaterials.audio);
  const hasModelImage = localFiles(state.talkingVideoGenerationMaterials.image)
    .some((file) => file.talkingVideoRole === 'model');
  const canSubmit = confirmed && Boolean(draft.trim()) && hasModelImage;
  const editorMaterials = {
    image: state.talkingVideoGenerationMaterials.image,
    audio: state.talkingVideoGenerationMaterials.audio,
  };

  useEffect(() => {
    if (state.talkingVideoGenerateModalOpen && !wasOpenRef.current) {
      setDraft(task?.prompt || '');
      setConfirmed(false);
      setPromptExpanded(false);
    }
    wasOpenRef.current = state.talkingVideoGenerateModalOpen;
  }, [state.talkingVideoGenerateModalOpen, task?.prompt]);

  if (!task) return null;

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(draft);
    message.success('提示词已复制');
  };

  return (
    <>
      <Modal
      centered
      className="talking-video-generation-modal"
      footer={(
        <div className="talking-video-modal-footer">
          {!confirmed && (
            <div className="talking-video-modal-confirmation">
              <div>
                <strong>请确认提示词是否符合预期。提示词会直接影响最终视频效果。</strong>
                <span>
                  {promptModified
                    ? '您已修改系统生成的提示词，请确认内容后继续生成。'
                    : '您当前未修改系统生成的提示词，如确认使用当前提示词，请点击确认后继续生成。'}
                </span>
              </div>
              <Button
                color="orange"
                onClick={() => setConfirmed(true)}
                size="small"
                variant="solid"
              >
                确认使用当前提示词
              </Button>
            </div>
          )}

          <p className="talking-video-modal-audio-note">
            {audioFiles.length
              ? '已选择参考音频，最终视频将使用该素材锁定口播声线。'
              : '未上传参考音频，最终视频将由模型按提示词中的台词自动生成口播声线，声音风格可能与预期有偏差。'}
          </p>

          <div className="talking-video-modal-submit-row">
            <div className="talking-video-modal-parameters">
              <span>镜头比例</span>
              <Dropdown
                menu={{
                  items: ratioOptions.map((ratio) => ({ key: ratio, label: ratio })),
                  onClick: ({ key }) => state.chooseCanvasRatio(key),
                  selectedKeys: [state.ratio],
                }}
                trigger={['click']}
              >
                <Button>
                  <span
                    aria-hidden="true"
                    className={`video-task-ratio-icon video-task-ratio-icon--panel talking-video-modal-ratio-icon ratio-${state.ratio.replace(':', '-')}`}
                  />
                  {state.ratio}
                  <ChevronDown size={14} />
                </Button>
              </Dropdown>
              <span>模型</span>
              <Dropdown
                menu={{
                  items: modelOptions.map((model) => ({ key: model, label: model })),
                  onClick: ({ key }) => state.chooseParam('model', key),
                  selectedKeys: [state.model],
                }}
                trigger={['click']}
              >
                <Button icon={<Layers3 size={15} />}>{state.model}<ChevronDown size={14} /></Button>
              </Dropdown>
              <span>清晰度</span>
              <Dropdown
                menu={{
                  items: qualityOptions.map((quality) => ({ key: quality.label, label: quality.label })),
                  onClick: ({ key }) => state.chooseCanvasQuality(key),
                  selectedKeys: [state.quality],
                }}
                trigger={['click']}
              >
                <Button icon={<ScanLine size={15} />}>{state.quality}<ChevronDown size={14} /></Button>
              </Dropdown>
            </div>
            <div className="talking-video-modal-submit-actions">
              {canSubmit && !state.isTalkingVideoSubmitting && state.talkingVideoGenerationPriceLabel ? (
                <span className="talking-video-modal-cost">
                  <CreditIcon />
                  {state.talkingVideoGenerationPriceLabel}
                </span>
              ) : null}
              <Button
                className="talking-video-modal-submit"
                disabled={!canSubmit || state.isTalkingVideoSubmitting}
                loading={state.isTalkingVideoSubmitting}
                onClick={() => void state.generateTalkingVideoFromPrompt(draft)}
                type="primary"
              >
                {state.isTalkingVideoSubmitting ? '提交中…' : '提交生成'}
              </Button>
            </div>
          </div>
        </div>
      )}
      onCancel={() => state.setTalkingVideoGenerateModalOpen(false)}
      open={state.talkingVideoGenerateModalOpen && !promptExpanded}
      keyboard={!promptExpanded}
      title={(
        <span className="talking-video-modal-heading">
          <strong>生成视频</strong>
          <small>选择参考图片、参考音频和镜头比例后提交</small>
        </span>
      )}
      width="min(1180px, calc(100vw - 48px))"
    >
      <div className="talking-video-modal-body">
        <div className="talking-video-modal-materials">
          <TalkingVideoImageMaterials
            description=""
            headerNote="模特必填，按 模特 → 产品 → 背景 → 细节 顺序参与生成；总图片数不超过 9 张"
            onImageFiles={state.fillTalkingVideoGenerationImageFiles}
            onImageRemove={(materialId) => state.removeTalkingVideoGenerationMaterial('image', materialId)}
            selectedMaterials={state.talkingVideoGenerationMaterials}
            title="参考图片"
          />

          <TalkingVideoAudioSelector state={state} />
        </div>

        <section className="talking-video-modal-prompt">
          <div className="talking-video-modal-prompt-actions">
            <Button
              aria-label="复制提示词"
              className="talking-video-modal-prompt-action"
              icon={<Copy size={16} />}
              onClick={() => void copyPrompt()}
              title="复制提示词"
              type="text"
            />
            <Button
              aria-label="全屏编辑提示词"
              className="talking-video-modal-prompt-action video-task-expand"
              icon={<Maximize size={18} />}
              onClick={() => setPromptExpanded(true)}
              shape="circle"
              title="全屏编辑提示词"
              type="text"
            />
          </div>
          <PromptMentionEditor
            minRows={1}
            onChange={(value) => {
              setDraft(value);
              setConfirmed(false);
            }}
            onPlaceholderFiles={state.fillTalkingVideoGenerationMentionFiles}
            placeholder="检查并调整口播分镜提示词"
            prompt={draft}
            selectedMaterials={editorMaterials}
            suggestionContainer="body"
          />
        </section>
      </div>
      </Modal>
      {promptExpanded ? (
        <PromptModal
          description="检查和调整口播分镜提示词，输入 @ 可引用参考素材"
          onClose={() => setPromptExpanded(false)}
          onPlaceholderFiles={state.fillTalkingVideoGenerationMentionFiles}
          onPromptChange={(value) => {
            setDraft(value);
            setConfirmed(false);
          }}
          placeholder="检查并调整口播分镜提示词"
          prompt={draft}
          selectedMaterials={editorMaterials}
          title="编辑提示词"
        />
      ) : null}
    </>
  );
}

function TalkingVideoAudioSelector({ state }: { state: VideoTaskCloneState }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const audioFiles = localFiles(state.talkingVideoGenerationMaterials.audio);
  const selectedAudio = audioFiles[0];
  const audioItems = useMemo(() => audioFiles.map((file): MediaAttachmentItem => ({
    background: 'var(--color-surface-muted)',
    caption: '口播',
    detail: file.audioDuration ? `${Math.round(file.audioDuration)}s` : '音频',
    id: file.id,
    src: resolveLocalMaterialUrl(file),
    name: file.name,
    type: 'audio',
  })), [audioFiles]);

  const handleAudioFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files).slice(0, 1) : [];
    event.currentTarget.value = '';
    if (files.length) void state.fillTalkingVideoGenerationAudioFiles(files);
  };

  const chooseVoiceAsset = async (asset: Parameters<typeof state.chooseLibraryAsset>[1]) => {
    await state.chooseTalkingVideoGenerationLibraryAsset(audioKind, asset);
    setLibraryOpen(false);
  };

  const libraryContent = (
    <div className="talking-video-voice-library">
      <AudioAssetLibraryPanel
        assets={state.voiceAssets}
        groupNameById={state.voiceGroupNameById}
        isLoading={state.isLoadingLibraryAssets}
        onChoose={chooseVoiceAsset}
        onClose={() => setLibraryOpen(false)}
        selectedAssetId={selectedAudio?.assetId}
      />
    </div>
  );

  return (
    <section className="talking-video-modal-audio">
      <header>
        <div><Music2 size={16} /><strong>参考音频</strong></div>
        <Popover
          content={libraryContent}
          onOpenChange={setLibraryOpen}
          open={libraryOpen}
          overlayClassName="talking-video-voice-library-popover"
          placement="bottomRight"
          trigger="click"
        >
          <Button icon={<Library size={14} />} shape="round" size="small">素材库</Button>
        </Popover>
      </header>
      <input
        accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
        className="video-task-native-file-input"
        onChange={handleAudioFiles}
        ref={inputRef}
        type="file"
      />
      <div className={`talking-video-modal-audio-content${selectedAudio ? ' is-filled' : ''}`}>
        {audioItems.length ? (
          <AudioMaterialStack
            disablePopover
            items={audioItems}
            onRemove={(item) => state.removeTalkingVideoGenerationMaterial('audio', item.id)}
          />
        ) : (
          <button onClick={() => inputRef.current?.click()} type="button">
            <Upload size={16} />
            <span>上传音频</span>
            <small>或点击「素材库」插入</small>
          </button>
        )}
      </div>
      <p>仅支持一段 MP3/WAV 音频，时长不超过 15 秒。</p>
    </section>
  );
}

function localFiles(value: SelectedMaterialValue): LocalMaterialFile[] {
  return Array.isArray(value) ? value : [];
}
