import { Music4, Video } from 'lucide-react';
import { MaterialSlot } from '../MaterialSlot';
import { ReferenceVideoCard } from '../ReferenceVideoCard';
import { AudioReferenceCard, FieldHeading } from './PromptPlanningPresentational';
import {
  audioMaterial,
  imageMaterial,
  videoMaterial,
} from './promptPlanningConfig';
import { toConfirmedReferenceVideo } from './materialHelpers';
import type { PromptPlanningController } from './usePromptPlanningController';
import './PromptPlanningSharedFields.scss';
import './PromptPlanningStepMaterialsUploads.scss';
import './PromptPlanningStepMaterials.scss';

type PromptPlanningStepMaterialsProps = {
  controller: PromptPlanningController;
};

export function PromptPlanningStepMaterials({ controller }: PromptPlanningStepMaterialsProps) {
  const {
    clearMaterial,
    handleLocalFiles,
    imageFiles,
    isAudioPlaying,
    materials,
    productName,
    referenceAudioFile,
    referenceVideoFile,
    removeMaterialAt,
    setPreviewVideo,
    setProductName,
    toggleAudio,
    videoInputRef,
    audioInputRef,
  } = controller;

  const triggerVideoInput = () => videoInputRef.current?.click();
  const triggerAudioInput = () => audioInputRef.current?.click();

  return (
    <>
      <FieldHeading title="商品素材" subtitle="必填 · 1-9 张 · 可拖入/粘贴" />
      <div className="video-task-epa-product-slot">
        <MaterialSlot
          item={imageMaterial}
          onClear={clearMaterial}
          onLocalFiles={handleLocalFiles}
          onOpen={() => undefined}
          onRemoveOne={() => removeMaterialAt('image', imageFiles.length - 1)}
          openMode="local"
          selected={materials.image}
        />
      </div>

      <FieldHeading
        title="参考视频"
        subtitle="选填 · 1条 · AI 拆解节奏/镜头/结构，脚本参考其结构"
      />
      {referenceVideoFile ? (
        <ReferenceVideoCard
          onPreview={() => setPreviewVideo(toConfirmedReferenceVideo(referenceVideoFile))}
          onRemove={() => clearMaterial(videoMaterial)}
          onReplace={triggerVideoInput}
          video={toConfirmedReferenceVideo(referenceVideoFile)}
        />
      ) : (
        <button className="video-task-epa-upload-bar" onClick={triggerVideoInput} type="button">
          <Video size={20} />
          <strong>点击上传参考视频</strong>
          <span>支持 mp4 / mov，识别时会自动拆解节奏与镜头结构</span>
        </button>
      )}

      <FieldHeading
        title="参考音色"
        subtitle="选填 · 1段 · 口播照这个音色配音（锁音色）"
      />
      {referenceAudioFile ? (
        <AudioReferenceCard
          file={referenceAudioFile}
          isPlaying={isAudioPlaying}
          onPlayToggle={() => toggleAudio(referenceAudioFile)}
          onRemove={() => clearMaterial(audioMaterial)}
          onReplace={triggerAudioInput}
        />
      ) : (
        <button className="video-task-epa-audio-upload" onClick={triggerAudioInput} type="button">
          <div className="video-task-epa-audio-upload-main">
            <Music4 size={16} />
            <strong>点击上传参考音色</strong>
          </div>
          <span>mp3 / wav · 口播对口型用该音色</span>
        </button>
      )}

      <FieldHeading title="想介绍的商品" subtitle="选填 · 多主体时帮 AI 聚焦" />
      <input
        className="video-task-epa-inline-input"
        onChange={(event) => setProductName(event.currentTarget.value)}
        placeholder="如：连衣裙"
        type="text"
        value={productName}
      />
    </>
  );
}
