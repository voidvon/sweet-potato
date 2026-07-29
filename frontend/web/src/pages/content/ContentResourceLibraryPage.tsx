import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { CreateResourceModal } from './assets/content-resource-library/CreateResourceModal';
import { FinishedWorksLibrary } from './assets/content-resource-library/FinishedWorksLibrary';
import type { ContentResourceLibraryPageProps } from './assets/content-resource-library/pageTypes';
import { ResourceGroupModal } from './assets/content-resource-library/ResourceGroupModal';
import { ResourceLibraryView } from './assets/content-resource-library/ResourceLibraryView';
import { ResourcePreviewLayer } from './assets/content-resource-library/ResourcePreviewLayer';
import { useContentResourceLibraryController } from './assets/content-resource-library/useContentResourceLibraryController';
import './assets/AssetLibraryPages.scss';

export function ContentResourceLibraryPage(props: ContentResourceLibraryPageProps) {
  const controller = useContentResourceLibraryController(props);

  if (controller.resourceType === 'finished_video') {
    return (
      <>
        <FinishedWorksLibrary controller={controller} />
        <ResourcePreviewLayer controller={controller} />
      </>
    );
  }

  return (
    <ContentStudioLayout>
      <ResourceLibraryView controller={controller} />
      <CreateResourceModal controller={controller} />
      <ResourceGroupModal controller={controller} />
      <ResourcePreviewLayer controller={controller} />
    </ContentStudioLayout>
  );
}
