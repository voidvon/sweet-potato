import { type ReactNode, Suspense, lazy } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  ContentStudioRouteFallback,
  ImmersiveRouteFallback,
} from '../../components/RouteLoadingFallback';
import { getContentDefaultPath } from '../../routes/routeConfig';
import type { ContentResourceType, CreativeModuleCode, User } from '../../types';

const ContentResourceLibraryPage = lazy(() => import('./ContentResourceLibraryPage').then((m) => ({ default: m.ContentResourceLibraryPage })));
const VideoRemakePage = lazy(() => import('./VideoRemakePage').then((m) => ({ default: m.VideoRemakePage })));
const VideoCreatePage = lazy(() => import('./VideoCreatePage').then((m) => ({ default: m.VideoCreatePage })));
const DigitalHumanAssetsPage = lazy(() => import('./assets/DigitalHumanAssetsPage').then((m) => ({ default: m.DigitalHumanAssetsPage })));
const RealPersonAssetsPage = lazy(() => import('./assets/RealPersonAssetsPage').then((m) => ({ default: m.RealPersonAssetsPage })));
const SceneAssetsPage = lazy(() => import('./assets/SceneAssetsPage').then((m) => ({ default: m.SceneAssetsPage })));
const ProductAssetsPage = lazy(() => import('./assets/ProductAssetsPage').then((m) => ({ default: m.ProductAssetsPage })));
const VoiceAssetsPage = lazy(() => import('./assets/VoiceAssetsPage').then((m) => ({ default: m.VoiceAssetsPage })));

type ContentStudioPageProps = {
  currentUser: User;
  moduleCode?: CreativeModuleCode;
};

const moduleResourceType: Partial<Record<CreativeModuleCode, ContentResourceType>> = {
  finished_assets: 'finished_video',
};

function routeFallbackFor(code: CreativeModuleCode | undefined) {
  if (code === 'video_remake') {
    return <ImmersiveRouteFallback />;
  }
  return <ContentStudioRouteFallback />;
}

export function ContentStudioPage({ currentUser, moduleCode: moduleCodeProp }: ContentStudioPageProps) {
  const { moduleCode } = useParams();
  const code = moduleCodeProp || (moduleCode as CreativeModuleCode | undefined);

  let page: ReactNode = null;

  if (code === 'video_remake') {
    page = <VideoRemakePage currentUser={currentUser} />;
  } else if (code === 'create_video') {
    page = <VideoCreatePage currentUser={currentUser} />;
  } else if (code === 'digital_human') {
    page = <DigitalHumanAssetsPage currentUser={currentUser} />;
  } else if (code === 'virtual_portrait_assets') {
    page = <DigitalHumanAssetsPage currentUser={currentUser} variant="virtual_portrait" />;
  } else if (code === 'real_person_assets') {
    page = <RealPersonAssetsPage currentUser={currentUser} />;
  } else if (code === 'ai_voice') {
    page = <VoiceAssetsPage currentUser={currentUser} />;
  } else if (code === 'scene_library') {
    page = <SceneAssetsPage currentUser={currentUser} />;
  } else if (code === 'product_assets') {
    page = <ProductAssetsPage currentUser={currentUser} />;
  } else {
    const resourceType = code ? moduleResourceType[code] : undefined;
    if (resourceType) {
      page = <ContentResourceLibraryPage currentUser={currentUser} resourceType={resourceType} />;
    }
  }

  if (!page) {
    return <Navigate to={getContentDefaultPath(currentUser)} replace />;
  }

  return <Suspense fallback={routeFallbackFor(code)}>{page}</Suspense>;
}
