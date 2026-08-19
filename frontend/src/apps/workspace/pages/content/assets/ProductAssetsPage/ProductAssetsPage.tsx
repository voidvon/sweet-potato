import { ContentResourceLibraryPage } from '../../ContentResourceLibraryPage';
import type { User } from '../../../../types';

type ProductAssetsPageProps = {
  currentUser: User;
};

export function ProductAssetsPage({ currentUser }: ProductAssetsPageProps) {
  return (
    <ContentResourceLibraryPage
      currentUser={currentUser}
      resourceOverride={{
        addHint: '直接上传产品图片到产品素材库',
        addTitle: '上传产品素材',
        createOkText: '上传素材',
        detailAddText: '继续上传',
        detailUploadText: '上传素材',
        emptyAssets: '上传产品图、卖点图和展示图后，会直接显示在这里。',
        emptyGroups: '暂无产品素材，可直接上传素材。',
        nameLabel: '产品素材',
        namePlaceholder: '产品素材',
        pageDescription: '管理产品图片、卖点图和展示素材，供视频制作引用。',
        uploadHint: '支持直接上传到默认产品素材库',
        uploadTitle: '上传产品素材',
      }}
      resourceType="product"
      singleDefaultGroup
    />
  );
}
