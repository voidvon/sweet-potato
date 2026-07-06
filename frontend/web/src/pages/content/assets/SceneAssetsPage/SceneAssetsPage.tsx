import { ContentResourceLibraryPage } from '../../ContentResourceLibraryPage';
import type { User } from '../../../../types';

type SceneAssetsPageProps = {
  currentUser: User;
};

export function SceneAssetsPage({ currentUser }: SceneAssetsPageProps) {
  return (
    <ContentResourceLibraryPage
      currentUser={currentUser}
      resourceOverride={{
        addHint: '直接上传场景图片到场景素材库',
        addTitle: '上传场景素材',
        createOkText: '上传素材',
        defaultGroup: '场景素材',
        detailAddText: '继续上传',
        detailUploadText: '上传图片',
        emptyAssets: '上传直播间、门店、展台等图片后，会直接显示在这里。',
        emptyGroups: '暂无场景素材，可直接上传图片。',
        nameLabel: '场景素材',
        namePlaceholder: '场景素材',
        pageDescription: '管理可用于视频背景、产品展示和氛围切换的图片素材。',
        uploadHint: '支持直接上传到默认场景素材库',
        uploadTitle: '上传场景图片',
      }}
      resourceType="scene"
      singleDefaultGroup
    />
  );
}
