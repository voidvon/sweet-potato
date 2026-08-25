import { useEffect } from 'react';
import { Button, Space, Table, Tabs } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { LlmPricingEditorModal } from './model-settings/LlmPricingEditorModal';
import { LlmPricingModal } from './model-settings/LlmPricingModal';
import { ModelFormModal } from './model-settings/ModelFormModal';
import {
  getCreateLabel,
  getModelSettingsColumns,
} from './model-settings/modelSettingsColumns';
import {
  modelTypeFromTabParam,
  visibleModelTypes,
} from './model-settings/modelSettingsConstants';
import { useModelSettingsData } from './model-settings/useModelSettingsData';
import './ModelSettingsPage.scss';
import { t } from '@shared/i18n';

export function ModelSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = modelTypeFromTabParam(searchParams.get('tab'));
  const modelSettings = useModelSettingsData();
  const tableRows = activeType === 'audio'
    ? modelSettings.audioConfigRows
    : activeType === 'video'
      ? modelSettings.videoConfigRows
      : modelSettings.configsByType[activeType];
  const columns = getModelSettingsColumns({
    activeType,
    audioProviders: modelSettings.audioProviders,
    configsByType: modelSettings.configsByType,
    llmModelPricing: modelSettings.llmModelPricing,
    onDelete: (record) => {
      void modelSettings.handleDelete(activeType, record);
    },
    onEdit: modelSettings.openEditModal,
    onMoveImageModel: (record, offset) => {
      void modelSettings.handleMoveImageModel(record, offset);
    },
    onSetDefault: (record) => {
      void modelSettings.handleSetDefault(activeType, record);
    },
    onVideoModelChange: (record, model) => {
      void modelSettings.handleVideoModelChange(record, model);
    },
    savingProviderId: modelSettings.savingProviderId,
    sortingImageModels: modelSettings.sortingImageModels,
    videoProviders: modelSettings.videoProviders,
  });

  function handleTabChange(key: string) {
    const nextType = modelTypeFromTabParam(key);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextType === 'llm') {
        next.delete('tab');
      } else {
        next.set('tab', nextType);
      }
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (!modelSettings.loadedTypes[activeType]) {
      void modelSettings.loadConfigs(activeType);
    }
  }, [activeType, modelSettings.loadedTypes]);

  useEffect(() => {
    visibleModelTypes
      .filter((item) => item.key !== activeType)
      .forEach((item) => {
        if (!modelSettings.loadedTypes[item.key]) {
          void modelSettings.loadConfigs(item.key);
        }
      });
  }, []);

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <p>{t("按 LLM、图片、视频、音频分类管理多个模型配置，并为每个类型选择默认模型。")}</p>
        </section>

        <section className="settings-section">
          <div className="model-config-toolbar">
            <Space>
              {activeType !== 'audio' && activeType !== 'video' && (
                <Button icon={<PlusOutlined />} onClick={() => modelSettings.openCreateModal(activeType)} type="primary">
                  {getCreateLabel(activeType)}
                </Button>
              )}
              {activeType === 'llm' && (
                <Button onClick={modelSettings.openLlmPricingModal}>{t("官方价格管理")}</Button>
              )}
            </Space>
          </div>

          <Tabs
            activeKey={activeType}
            items={visibleModelTypes.map((item) => ({ key: item.key, label: item.label }))}
            onChange={handleTabChange}
          />

          <Table
            columns={columns}
            dataSource={tableRows}
            loading={Boolean(modelSettings.loadingByType[activeType])}
            pagination={false}
            rowKey={(record) => record.id || record.provider}
          />
        </section>

        <ModelFormModal
          activeType={activeType}
          audioProviders={modelSettings.audioProviders}
          imageProviders={modelSettings.imageProviders}
          editingRecord={modelSettings.editingRecord}
          llmModelPricing={modelSettings.llmModelPricing}
          onCancel={() => modelSettings.setModalOpen(false)}
          onOpenLlmPricing={() => {
            modelSettings.setModalOpen(false);
            modelSettings.openLlmPricingModal();
          }}
          onSaved={() => {
            void modelSettings.handleModelSaved(activeType);
          }}
          open={modelSettings.modalOpen}
          videoProviders={modelSettings.videoProviders}
        />
        <LlmPricingModal
          llmModelPricing={modelSettings.llmModelPricing}
          onCancel={() => modelSettings.setLlmPricingModalOpen(false)}
          onDelete={(record) => {
            void modelSettings.handleDeleteLlmPricing(record);
          }}
          onEdit={modelSettings.openEditLlmPricingModal}
          onOpenCreate={modelSettings.openCreateLlmPricingModal}
          open={modelSettings.llmPricingModalOpen}
        />
        <LlmPricingEditorModal
          editingRecord={modelSettings.editingLlmPricing}
          onCancel={() => modelSettings.setLlmPricingEditorModalOpen(false)}
          onSaved={() => {
            void modelSettings.handleLlmPricingSaved();
          }}
          open={modelSettings.llmPricingEditorModalOpen}
        />
      </section>
    </ContentStudioLayout>
  );
}
