import { ContentResourceLibraryPage } from '../../ContentResourceLibraryPage';
import type { User } from '../../../../types';
import { t } from '@shared/i18n';

type ProductAssetsPageProps = {
  currentUser: User;
};

export function ProductAssetsPage({ currentUser }: ProductAssetsPageProps) {
  return (
    <ContentResourceLibraryPage
      currentUser={currentUser}
      resourceOverride={{
        addHint: t("直接上传产品图片到产品素材库"),
        addTitle: t("上传产品素材"),
        createOkText: t("上传素材"),
        detailAddText: t("继续上传"),
        detailUploadText: t("上传素材"),
        emptyAssets: t("上传产品图、卖点图和展示图后，会直接显示在这里。"),
        emptyGroups: t("暂无产品素材，可直接上传素材。"),
        nameLabel: t("产品素材"),
        namePlaceholder: t("产品素材"),
        pageDescription: t("管理产品图片、卖点图和展示素材，供视频制作引用。"),
        uploadHint: t("支持直接上传到默认产品素材库"),
        uploadTitle: t("上传产品素材"),
      }}
      resourceType="product"
      singleDefaultGroup
    />
  );
}
