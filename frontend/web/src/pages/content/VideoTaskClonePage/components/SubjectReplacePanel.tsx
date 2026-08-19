import { Checkbox } from 'antd';
import { useMemo } from 'react';
import { subjectReplaceTypeOptions } from '../../shared/videoGenerationOptions';
import type { SubjectReplaceType } from '../types';
import type { VideoTaskCloneState } from '../useVideoTaskCloneState';
import { MaterialPanel } from './MaterialPanel';
import { MaterialSlot } from './MaterialSlot';
import { VideoSourcePanel } from './VideoSourcePanel';
import { WorkspaceSection } from './WorkspaceSection';
import './SubjectReplacePanel.scss';

type SubjectReplacePanelProps = {
  state: VideoTaskCloneState;
};

const subjectTypes = subjectReplaceTypeOptions.map((option) => ({
  key: option.value as SubjectReplaceType,
  label: option.label,
  uploadLabel: option.uploadLabel,
}));

export function SubjectReplacePanel({ state }: SubjectReplacePanelProps) {
  const subjectType = state.subjectReplaceType;
  const selectedType = subjectTypes.find((item) => item.key === subjectType) ?? subjectTypes[0];
  const subjectTool = useMemo(() => ({
    ...state.tool,
    materialHint: subjectType === 'model' ? '上传人物全身图' : `上传清晰的${selectedType.label}图片`,
    materials: state.tool.materials.map((item) => item.key === 'image' ? {
      ...item,
      label: selectedType.uploadLabel,
      maxCount: subjectType === 'clothing' ? 2 : 1,
    } : item),
  }), [selectedType.label, selectedType.uploadLabel, state.tool, subjectType]);
  const videoMaterial = subjectTool.materials.find((item) => item.key === 'video');
  const imageMaterial = subjectTool.materials.find((item) => item.key === 'image');
  const selectedImages = Array.isArray(state.selectedMaterials.image) ? state.selectedMaterials.image : [];
  const hasFrontImage = Boolean(state.selectedMaterials.image);

  const chooseSubjectType = (nextType: SubjectReplaceType) => {
    if (subjectType === 'clothing' && nextType !== 'clothing' && selectedImages.length > 1 && imageMaterial) {
      state.replaceMaterialFiles(imageMaterial, selectedImages.slice(0, 1));
    }
    state.setSubjectReplaceType(nextType);
  };

  if (!videoMaterial || !imageMaterial) return null;

  const clothingSlots = subjectType === 'clothing' ? (
    <>
      <MaterialSlot
        item={{ ...imageMaterial, hint: '限 1 张', label: '正面图', maxCount: 1, meta: '可选' }}
        onClear={state.clearMaterial}
        onLocalFiles={(_, files) => state.fillMaterialFiles(imageMaterial, files)}
        onOpen={() => undefined}
        onRemoveOne={(_, materialId) => {
          if (selectedImages.length > 1) {
            state.clearMaterial(imageMaterial);
            return;
          }
          state.removeOneMaterial(imageMaterial, materialId);
        }}
        onReplaceFiles={state.replaceMaterialFiles}
        openMode="local"
        selected={selectedImages.length > 0 ? selectedImages.slice(0, 1) : state.selectedMaterials.image}
      />
      <MaterialSlot
        disabled={!hasFrontImage}
        item={{ ...imageMaterial, hint: hasFrontImage ? '限 1 张' : '请先上传正面图', label: '反面图', maxCount: 1, meta: '可选' }}
        onClear={state.clearMaterial}
        onLocalFiles={(_, files) => state.fillMaterialFiles(imageMaterial, files)}
        onOpen={() => undefined}
        onRemoveOne={(_, materialId) => state.removeOneMaterial(imageMaterial, materialId)}
        onReplaceFiles={state.replaceMaterialFiles}
        openMode="local"
        selected={selectedImages.length > 1 ? selectedImages.slice(1, 2) : undefined}
      />
    </>
  ) : undefined;

  return (
    <>
      <MaterialPanel
        activeUpload={state.activeUpload}
        isLoadingLibraryAssets={state.isLoadingLibraryAssets}
        materialMode={state.materialMode}
        materialSlots={clothingSlots}
        onClosePopovers={state.closeMaterialPopovers}
        onLibraryAssetChoose={state.chooseLibraryAsset}
        onMaterialClear={state.clearMaterial}
        onMaterialRemoveOne={state.removeOneMaterial}
        onMaterialsClearAll={() => {
          subjectTool.materials
            .filter((item) => item.key !== 'video' && state.selectedMaterials[item.key])
            .forEach(state.clearMaterial);
        }}
        onMaterialFill={state.fillMaterial}
        onMaterialLocalFiles={state.fillMaterialFiles}
        onMaterialReplaceFiles={state.replaceMaterialFiles}
        onModelPickerOpen={state.openModelPicker}
        onTabChange={state.chooseMaterialTab}
        onUploadClose={() => state.setActiveUpload(null)}
        onUploadOpen={state.setActiveUploadWithAnchor}
        onVoiceChange={state.setVoiceEnabled}
        onWorksTabChange={state.setWorksTab}
        selectedMaterials={state.selectedMaterials}
        showVoiceToggle={false}
        tool={subjectTool}
        topSlot={(
          <div className="subject-replace-type-slot">
            <span className="subject-replace-title">
              <strong>图片类型</strong>
              <small>已选择：{selectedType.label}</small>
            </span>
            <div className="subject-replace-type-grid" role="radiogroup" aria-label="图片类型">
              {subjectTypes.map((item) => (
                <button
                  aria-checked={subjectType === item.key}
                  className={subjectType === item.key ? 'is-active' : ''}
                  key={item.key}
                  onClick={() => chooseSubjectType(item.key)}
                  role="radio"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        uploadAnchor={state.uploadAnchor}
        visibleMaterialKeys={['image']}
        voiceAssets={state.voiceAssets}
        voiceEnabled={state.voiceEnabled}
        voiceGroupNameById={state.voiceGroupNameById}
        worksAssets={state.worksAssets}
        worksTab={state.worksTab}
      />

      <VideoSourcePanel
        material={videoMaterial}
        onMaterialClear={state.clearMaterial}
        onMaterialLocalFiles={state.fillMaterialFiles}
        onMaterialRemoveOne={state.removeOneMaterial}
        onMaterialReplaceFiles={state.replaceMaterialFiles}
        onUrlSubmit={state.resolveVideoSource}
        selected={state.selectedMaterials.video}
      />

      <WorkspaceSection className="subject-replace-audio-section" showHeader={false} title="参考视频声音">
        <Checkbox checked={state.voiceEnabled} onChange={(event) => state.setVoiceEnabled(event.target.checked)}>
          保留参考视频里的音乐和节奏，适合舞蹈、卡点、BGM 视频。
        </Checkbox>
      </WorkspaceSection>
    </>
  );
}
