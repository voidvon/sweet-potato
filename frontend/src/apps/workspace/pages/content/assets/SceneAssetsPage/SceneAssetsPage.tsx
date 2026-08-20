import { ContentResourceLibraryPage } from '../../ContentResourceLibraryPage';
import type { User } from '../../../../types';
import { t } from '@shared/i18n';

type SceneAssetsPageProps = {
  currentUser: User;
};

export function SceneAssetsPage({ currentUser }: SceneAssetsPageProps) {
  return (
    <ContentResourceLibraryPage
      currentUser={currentUser}
      resourceOverride={{
        addHint: t("直接上传场景图片到场景素材库"),
        addTitle: t("上传场景素材"),
        createOkText: t("上传素材"),
        defaultGroup: t("场景素材"),
        detailAddText: t("继续上传"),
        detailUploadText: t("上传图片"),
        emptyAssets: t("上传直播间、门店、展台等图片后，会直接显示在这里。"),
        emptyGroups: t("暂无场景素材，可直接上传图片。"),
        nameLabel: t("场景素材"),
        namePlaceholder: t("场景素材"),
        pageDescription: t("管理可用于视频背景、产品展示和氛围切换的图片素材。"),
        uploadHint: t("支持直接上传到默认场景素材库"),
        uploadTitle: t("上传场景图片"),
      }}
      resourceType="scene"
      singleDefaultGroup
    />
  );
}
