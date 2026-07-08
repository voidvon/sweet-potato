import { Image, message, Modal, Spin } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { Package, Trees, UserRound, X } from 'lucide-react';
import { listContentAssetsPage } from '../../../../api/content';
import { resolveAssetUrl } from '../../../../api/request';
import type { ContentAsset, ContentAssetResourceType, User } from '../../../../types';

type ModelPickerProps = {
  onClose: () => void;
  onSelect: (asset: ContentAsset) => void;
  selectedModelAvatar: string;
  user: User;
};

type AssetTabKey = 'real_person' | 'scene' | 'product';

type AssetTabState = {
  hasMore: boolean;
  items: ContentAsset[];
  isLoading: boolean;
  page: number;
  total: number;
};

const PAGE_SIZE = 20;

const tabs: Array<{
  icon: typeof UserRound;
  key: AssetTabKey;
  label: string;
  resourceTypes: ContentAssetResourceType[];
}> = [
  { icon: UserRound, key: 'real_person', label: '人物', resourceTypes: ['real_person', 'virtual_portrait'] },
  { icon: Trees, key: 'scene', label: '场景', resourceTypes: ['scene'] },
  { icon: Package, key: 'product', label: '产品', resourceTypes: ['product'] },
];

const defaultTabState: AssetTabState = {
  hasMore: true,
  items: [],
  isLoading: false,
  page: 0,
  total: 0,
};

export function ModelPicker({
  onClose,
  onSelect,
  selectedModelAvatar,
  user,
}: ModelPickerProps) {
  const [activeTab, setActiveTab] = useState<AssetTabKey>('real_person');
  const [tabStates, setTabStates] = useState<Record<AssetTabKey, AssetTabState>>({
    real_person: defaultTabState,
    scene: defaultTabState,
    product: defaultTabState,
  });
  const tabStatesRef = useRef(tabStates);

  useEffect(() => {
    tabStatesRef.current = tabStates;
  }, [tabStates]);

  const loadTabPage = useCallback(async (tabKey: AssetTabKey, nextPage = 1) => {
    const tab = tabs.find((item) => item.key === tabKey);
    if (!tab) return;
    const currentState = tabStatesRef.current[tabKey];
    if (currentState.isLoading) return;
    if (nextPage > 1 && !currentState.hasMore) return;

    setTabStates((current) => ({
      ...current,
      [tabKey]: {
        ...current[tabKey],
        isLoading: true,
      },
    }));
    try {
      const result = await loadAssetTabResult({
        page: nextPage,
        pageSize: PAGE_SIZE,
        resourceTypes: tab.resourceTypes,
        userId: user.id,
      });
      const usableItems = result.items.filter((asset) => asset.mimeType.startsWith('image/'));
      setTabStates((current) => {
        const previousItems = nextPage === 1 ? [] : current[tabKey].items;
        const existingIds = new Set(previousItems.map((asset) => asset.id));
        const mergedItems = [
          ...previousItems,
          ...usableItems.filter((asset) => !existingIds.has(asset.id)),
        ];
        return {
          ...current,
          [tabKey]: {
            hasMore: result.page * result.pageSize < result.total,
            items: mergedItems,
            isLoading: false,
            page: result.page,
            total: result.total,
          },
        };
      });
    } catch {
      message.error('素材加载失败');
      setTabStates((current) => ({
        ...current,
        [tabKey]: {
          ...current[tabKey],
          isLoading: false,
          hasMore: false,
        },
      }));
    }
  }, [user.id]);

  useEffect(() => {
    const currentState = tabStatesRef.current[activeTab];
    if (currentState.page === 0 && !currentState.isLoading) {
      void loadTabPage(activeTab, 1);
    }
  }, [activeTab, loadTabPage]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const currentState = tabStates[activeTab];
    if (currentState.isLoading || !currentState.hasMore) return;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 96) {
      void loadTabPage(activeTab, currentState.page + 1);
    }
  };

  const activeState = tabStates[activeTab];

  return (
    <Modal
      centered
      className="vc-model-picker video-task-model-picker"
      closable={false}
      footer={null}
      mask={{ closable: true }}
      onCancel={onClose}
      open
      styles={{
        body: { padding: 0 },
      }}
      title={null}
      width={720}
    >
      <section className="vc-model-picker__panel">
        <header className="vc-model-picker__head">
          <div className="vc-model-picker__head-text">
            <strong>选择素材</strong>
            <p>从素材库挑一张，会作为参考图加进合成区</p>
          </div>
          <button aria-label="关闭素材库" className="vc-model-picker__close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="vc-model-picker__tabs" role="tablist">
          {tabs.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                aria-selected={isActive}
                className={`vc-model-picker__tab${isActive ? ' is-active' : ''}`}
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                role="tab"
                type="button"
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="vc-model-picker__body" onScroll={handleScroll}>
          <div className="vc-model-picker__grid">
            {activeState.items.map((asset) => {
              const name = getModelAssetName(asset);
              return (
              <button
                className={`vc-model-picker__card${selectedModelAvatar === asset.id ? ' is-active' : ''}`}
                key={asset.id}
                onClick={() => onSelect(asset)}
                type="button"
              >
                <span className="vc-model-picker__thumb">
                  <Image
                    alt={name}
                    loading="lazy"
                    preview={false}
                    src={resolveAssetUrl(asset.fileUrl)}
                    style={{ height: '100%', objectFit: 'cover', width: '100%' }}
                  />
                </span>
                <small title={name}>{name}</small>
              </button>
              );
            })}
            {activeState.isLoading && (
              <span className="video-task-assets-empty vc-model-picker__loading">
                <Spin size="small" />
                正在加载素材
              </span>
            )}
            {!activeState.isLoading && activeState.items.length === 0 && (
              <span className="video-task-assets-empty">暂无{tabs.find((item) => item.key === activeTab)?.label}素材</span>
            )}
          </div>
          {!activeState.isLoading && activeState.items.length > 0 && !activeState.hasMore && (
            <em className="vc-model-picker__end">— 没有更多 —</em>
          )}
        </div>
      </section>
    </Modal>
  );
}

function getModelAssetName(asset: ContentAsset) {
  return asset.name || asset.originalFileName || asset.storedFileName || '素材';
}

async function loadAssetTabResult(input: {
  page: number;
  pageSize: number;
  resourceTypes: ContentAssetResourceType[];
  userId: string;
}) {
  const results = await Promise.all(input.resourceTypes.map((resourceType) => (
    listContentAssetsPage({
      page: input.page,
      pageSize: input.pageSize,
      resourceType,
      userId: input.userId,
    })
  )));
  if (results.length === 1) {
    return results[0];
  }
  const primary = results[0];
  const fallback = results[1];
  if (input.page === 1 && primary.items.length > 0) {
    return primary;
  }
  if (primary.total > 0) {
    return primary;
  }
  return {
    ...fallback,
    total: fallback.total,
  };
}
