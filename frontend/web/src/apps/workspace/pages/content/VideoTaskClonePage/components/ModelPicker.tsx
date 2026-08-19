import { message, Modal, Spin } from 'antd';
import { memo, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent, UIEvent } from 'react';
import { Package, Trees, UserRound, X } from 'lucide-react';
import { listContentAssetGroups, listContentAssetsPage } from '../../../../api/content';
import { API_BASE_URL, resolveAssetUrl } from '../../../../api/request';
import type { ContentAsset, ContentAssetGroup, ContentAssetResourceType, User } from '../../../../types';

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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<AssetTabKey>('real_person');
  const [tabStates, setTabStates] = useState<Record<AssetTabKey, AssetTabState>>({
    real_person: defaultTabState,
    scene: defaultTabState,
    product: defaultTabState,
  });
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [visibleAssetIds, setVisibleAssetIds] = useState<Set<string>>(() => new Set());
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
      const shouldUseGroupName = tabKey === 'real_person';
      const [result, groups] = await Promise.all([
        loadAssetTabResult({
          page: nextPage,
          pageSize: PAGE_SIZE,
          resourceTypes: tab.resourceTypes,
          userId: user.id,
        }),
        shouldUseGroupName && nextPage === 1
          ? loadAssetGroups(user.id, tab.resourceTypes)
          : Promise.resolve<ContentAssetGroup[]>([]),
      ]);
      const usableItems = result.items.filter((asset) => asset.mimeType.startsWith('image/'));
      if (groups.length > 0) {
        setGroupNameById((current) => ({
          ...current,
          ...Object.fromEntries(groups.map((group) => [group.id, group.name])),
        }));
      }
      setTabStates((current) => {
        const previousItems = nextPage === 1 ? [] : current[tabKey].items;
        const existingIds = new Set(previousItems.map((asset) => asset.id));
        const mergedItems = [
          ...previousItems,
          ...usableItems.filter((asset) => !existingIds.has(asset.id)),
        ];
        mergedItems.sort((left, right) => (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        ));
        return {
          ...current,
          [tabKey]: {
            hasMore: result.hasMore,
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

  useEffect(() => {
    const currentState = tabStates[activeTab];
    const body = bodyRef.current;
    if (!body || currentState.page === 0 || currentState.isLoading || !currentState.hasMore) {
      return;
    }
    if (body.scrollHeight <= body.clientHeight + 4) {
      void loadTabPage(activeTab, currentState.page + 1);
    }
  }, [activeTab, loadTabPage, tabStates]);

  const activeState = tabStates[activeTab];

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof IntersectionObserver === 'undefined') {
      setVisibleAssetIds((current) => {
        const next = new Set(current);
        activeState.items.forEach((asset) => next.add(asset.id));
        return next;
      });
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      const intersectingIds = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => (entry.target as HTMLElement).dataset.assetId)
        .filter((assetId): assetId is string => Boolean(assetId));
      if (!intersectingIds.length) return;
      startTransition(() => {
        setVisibleAssetIds((current) => {
          if (intersectingIds.every((assetId) => current.has(assetId))) {
            return current;
          }
          const next = new Set(current);
          intersectingIds.forEach((assetId) => next.add(assetId));
          return next;
        });
      });
    }, {
      root: body,
      rootMargin: '160px 0px',
    });
    body.querySelectorAll<HTMLElement>('[data-asset-id]').forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [activeState.items]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const currentState = tabStates[activeTab];
    if (currentState.isLoading || !currentState.hasMore) return;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 96) {
      void loadTabPage(activeTab, currentState.page + 1);
    }
  };

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
        <div className="vc-model-picker__body" onScroll={handleScroll} ref={bodyRef}>
          <div className="vc-model-picker__grid">
            {activeState.items.map((asset) => {
              const name = getModelAssetName(asset, groupNameById);
              return (
                <ModelAssetCard
                  asset={asset}
                  isSelected={selectedModelAvatar === asset.id}
                  isVisible={visibleAssetIds.has(asset.id)}
                  key={asset.id}
                  name={name}
                  onSelect={onSelect}
                />
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

const ModelAssetCard = memo(function ModelAssetCard({
  asset,
  isSelected,
  isVisible,
  name,
  onSelect,
}: {
  asset: ContentAsset;
  isSelected: boolean;
  isVisible: boolean;
  name: string;
  onSelect: (asset: ContentAsset) => void;
}) {
  return (
    <button
      className={`vc-model-picker__card${isSelected ? ' is-active' : ''}`}
      data-asset-id={asset.id}
      onClick={() => onSelect(asset)}
      type="button"
    >
      <span className="vc-model-picker__thumb">
        {isVisible ? (
          <img
            alt={name}
            decoding="async"
            loading="lazy"
            onError={(event) => handleThumbnailError(event, modelPickerAssetUrl(asset))}
            src={modelPickerThumbnailUrl(asset)}
          />
        ) : null}
      </span>
      <small title={name}>{name}</small>
    </button>
  );
});

function getModelAssetName(asset: ContentAsset, groupNameById: Record<string, string>) {
  if (asset.resourceType === 'real_person' || asset.resourceType === 'virtual_portrait') {
    return groupNameById[asset.groupId] || asset.name || asset.originalFileName || asset.storedFileName || '素材';
  }
  return asset.name || asset.originalFileName || asset.storedFileName || '素材';
}

function modelPickerAssetUrl(asset: ContentAsset) {
  const localMirrorUrl = typeof asset.metadata?.localMirrorUrl === 'string' ? asset.metadata.localMirrorUrl.trim() : '';
  if (asset.resourceType === 'virtual_portrait' && localMirrorUrl) {
    return `${API_BASE_URL}${localMirrorUrl.startsWith('/') ? localMirrorUrl : `/${localMirrorUrl}`}`;
  }
  return resolveAssetUrl(asset.fileUrl);
}

function modelPickerThumbnailUrl(asset: ContentAsset) {
  const params = new URLSearchParams({
    size: '256',
    version: asset.updatedAt,
  });
  return `${API_BASE_URL}/api/content/assets/${encodeURIComponent(asset.id)}/thumbnail?${params.toString()}`;
}

function handleThumbnailError(event: SyntheticEvent<HTMLImageElement>, fallbackUrl: string) {
  const image = event.currentTarget;
  if (!fallbackUrl || image.dataset.fallback === 'true') {
    return;
  }
  image.dataset.fallback = 'true';
  image.src = fallbackUrl;
}

async function loadAssetGroups(userId: string, resourceTypes: ContentAssetResourceType[]) {
  const results = await Promise.all(resourceTypes.map((resourceType) => listContentAssetGroups(userId, resourceType)));
  return results.flat();
}

async function loadAssetTabResult(input: {
  page: number;
  pageSize: number;
  resourceTypes: ContentAssetResourceType[];
  userId: string;
}) {
  if (!input.resourceTypes.length) {
    return {
      hasMore: false,
      items: [],
      page: input.page,
      pageSize: 0,
      total: 0,
    };
  }
  const effectivePageSize = Math.max(input.pageSize, input.resourceTypes.length);
  const basePageSize = Math.floor(effectivePageSize / input.resourceTypes.length);
  const pageSizeRemainder = effectivePageSize % input.resourceTypes.length;
  const results = await Promise.all(input.resourceTypes.map((resourceType, index) => (
    listContentAssetsPage({
      page: input.page,
      pageSize: basePageSize + (index < pageSizeRemainder ? 1 : 0),
      resourceType,
      userId: input.userId,
    })
  )));
  return {
    hasMore: results.some((result) => result.page * result.pageSize < result.total),
    items: results.flatMap((result) => result.items),
    page: input.page,
    pageSize: results.reduce((sum, result) => sum + result.pageSize, 0),
    total: results.reduce((sum, result) => sum + result.total, 0),
  };
}
