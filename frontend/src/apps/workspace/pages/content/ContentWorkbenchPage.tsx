import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Tag } from 'antd';
import { ContactRound, Mic2, PlayCircle, RefreshCw, Sparkles, UserRound, Video } from 'lucide-react';
import { listContentAssetGroups, listContentAssets, listVideoTasks } from '../../api/content';
import { appSocketManager } from '@/app/AppSocketManager';
import { getContentNavigationRoutes } from '../../routes/routeConfig';
import type { ContentAsset, ContentAssetGroup, ContentAssetResourceType, User, VideoGenerationTask } from '../../types';
import './ContentWorkbenchPage.scss';
import { t } from '@shared/i18n';
import { useRouteResourceInfoMap } from '@shared/hooks/useRouteResourceNames';

type ContentWorkbenchPageProps = {
  currentUser: User;
};

function isGeneratedFinishedVideoAsset(asset: ContentAsset) {
  return asset.resourceType === 'finished_video'
    && (asset.metadata?.generatedBy === 'video_model' || asset.metadata?.generatedBy === 'video_enhancement');
}

function assetResourceType(asset: ContentAsset): ContentAssetResourceType {
  return asset.resourceType as ContentAssetResourceType;
}

const moduleMeta: Record<string, {
  accent: string;
  icon: typeof UserRound;
  summary: string;
  resourceType?: ContentAssetResourceType;
}> = {
  virtual_portrait_assets: {
    accent: 'var(--color-purple)',
    icon: ContactRound,
    summary: t("管理虚拟人像成品、三视图训练和私域入库状态"),
    resourceType: 'virtual_portrait',
  },
  ai_voice: {
    accent: 'var(--color-success-bright)',
    icon: Mic2,
    summary: t("管理音色、试听音频、语速和情绪标签"),
    resourceType: 'voice',
  },
  real_person_assets: {
    accent: 'var(--color-teal)',
    icon: ContactRound,
    summary: t("管理真人认证、同人素材和入库状态"),
    resourceType: 'real_person',
  },
  scene_library: {
    accent: 'var(--color-warning)',
    icon: Video,
    summary: t("管理背景、空间、产品展示和短视频场景"),
    resourceType: 'scene',
  },
  product_assets: {
    accent: 'var(--color-purple)',
    icon: Sparkles,
    summary: t("管理产品图片、卖点说明和商品展示素材"),
    resourceType: 'product',
  },
  finished_assets: {
    accent: 'var(--color-cyan)',
    icon: PlayCircle,
    summary: t("管理图片创作和视频生成产出的作品"),
    resourceType: 'finished_video',
  },
  create_video: {
    accent: 'var(--color-brand-active)',
    icon: Video,
    summary: t("选择参数、参考素材和提示词制作视频"),
  },
};

export function ContentWorkbenchPage({ currentUser }: ContentWorkbenchPageProps) {
  const navigate = useNavigate();
  const routeResourceInfoMap = useRouteResourceInfoMap('web');
  const contentNavigationRoutes = useMemo(
    () => getContentNavigationRoutes(currentUser, routeResourceInfoMap),
    [currentUser, routeResourceInfoMap],
  );
  const [groups, setGroups] = useState<ContentAssetGroup[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [videoTasks, setVideoTasks] = useState<VideoGenerationTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const loadRequestIdRef = useRef(0);

  const loadWorkbench = useCallback(async (options?: { showLoading?: boolean }) => {
    const requestId = ++loadRequestIdRef.current;
    try {
      if (options?.showLoading !== false) {
        setIsLoading(true);
      }
      const [groupList, assetList, taskList] = await Promise.all([
        listContentAssetGroups(currentUser.id),
        listContentAssets({ userId: currentUser.id }),
        listVideoTasks(currentUser.id),
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      setGroups(groupList);
      setAssets(assetList);
      setVideoTasks(taskList);
      setError('');
    } catch (requestError) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(requestError instanceof Error ? requestError.message : t("内容创作工作台加载失败"));
    } finally {
      if (requestId === loadRequestIdRef.current) setIsLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);
  useEffect(() => () => { loadRequestIdRef.current += 1; }, []);

  useEffect(() => {
    return appSocketManager.subscribe((event) => {
      if (event.method === 'video-generation-complete' || event.method === 'app/video-generation-complete') {
        void loadWorkbench({ showLoading: false });
      }
    });
  }, [currentUser.id, loadWorkbench]);

  const stats = useMemo(() => ({
    groups: groups.length,
    assets: assets.length,
    virtualPortraits: assets.filter((asset) => asset.resourceType === 'virtual_portrait').length,
    realPersons: assets.filter((asset) => assetResourceType(asset) === 'real_person').length,
    voices: assets.filter((asset) => asset.resourceType === 'voice').length,
    scenes: assets.filter((asset) => asset.resourceType === 'scene').length,
    products: assets.filter((asset) => asset.resourceType === 'product').length,
    finishedVideos: assets.filter(isGeneratedFinishedVideoAsset).length,
    videos: videoTasks.length,
  }), [assets, groups.length, videoTasks.length]);

  return (
    <div className="content-workbench-page">
      {error && <div className="notice">{error}</div>}

      <section className="content-workbench-hero">
        <div>
          <p className="eyebrow">AI CONTENT ASSETS</p>
          <h1>{t("内容创作素材库")}</h1>
          <p>{t("统一管理数字人、AI语音、场景素材，并通过视频 URL 解析生成可编辑的视频创作草稿。")}</p>
        </div>
        <div className="workbench-hero-actions">
          <Button icon={<RefreshCw size={16} />} loading={isLoading} onClick={() => window.location.reload()}>
            {t("刷新")}
          </Button>
        </div>
      </section>

      <section className="workbench-stat-grid">
        <article className="workbench-stat-card">
          <strong>{stats.groups}</strong>
          <p>{t("全局分组")}</p>
          <small>{t("素材按组管理")}</small>
        </article>
        <article className="workbench-stat-card">
          <strong>{stats.assets}</strong>
          <p>{t("素材总数")}</p>
          <small>{t("真实文件已保存")}</small>
        </article>
        <article className="workbench-stat-card">
          <strong>{stats.virtualPortraits + stats.realPersons + stats.voices + stats.scenes + stats.products}</strong>
          <p>{t("可用创作素材")}</p>
          <small>{t("虚拟人像 / 真人 / 语音 / 场景 / 产品")}</small>
        </article>
        <article className="workbench-stat-card">
          <strong>{stats.videos}</strong>
          <p>{t("视频草稿")}</p>
          <small>{t("URL 解析与生成记录")}</small>
        </article>
      </section>

      <section className="workbench-section-heading">
        <div>
          <p className="eyebrow">{t("快速入口")}</p>
          <h2>{t("选择内容模块")}</h2>
        </div>
      </section>

      <section className="workbench-module-grid">
        {contentNavigationRoutes.map((route) => {
          const meta = moduleMeta[route.code];
          const Icon = meta.icon;
          const count = meta.resourceType
            ? assets.filter((asset) => (
              meta.resourceType === 'finished_video'
                ? isGeneratedFinishedVideoAsset(asset)
                : assetResourceType(asset) === meta.resourceType
            )).length
            : videoTasks.length;
          return (
            <button
              className="workbench-module-card"
              key={route.code}
              onClick={() => navigate(route.path)}
              style={{ '--module-accent': meta.accent } as CSSProperties}
              type="button"
            >
              <span className="workbench-module-icon"><Icon size={22} /></span>
              <span className="workbench-module-copy">
                <strong>{route.name}</strong>
                <small>{meta.summary}</small>
              </span>
              <span className="workbench-module-metrics">
                <Tag color="processing">{count} {t("项")}</Tag>
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
