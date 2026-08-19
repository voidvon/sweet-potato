import { ContentStudioLayout } from '../../../../layouts/ContentStudioLayout'
import '../AssetLibraryPages.scss'
import { DigitalHumanAssetGrid } from './components/DigitalHumanAssetGrid'
import { DigitalHumanCreateModals } from './components/DigitalHumanCreateModals'
import { DigitalHumanDetailModal } from './components/DigitalHumanDetailModal'
import { DigitalHumanImagePreview } from './components/DigitalHumanImagePreview'
import { useDigitalHumanAssetsController } from './useDigitalHumanAssetsController'
import type { DigitalHumanAssetsPageProps } from './useDigitalHumanAssetsController'

export function DigitalHumanAssetsPage(props: DigitalHumanAssetsPageProps) {
  const controller = useDigitalHumanAssetsController(props)

  return (
    <ContentStudioLayout>
      <DigitalHumanAssetGrid controller={controller} />
      <DigitalHumanCreateModals controller={controller} />
      <DigitalHumanDetailModal controller={controller} />
      <DigitalHumanImagePreview controller={controller} />
    </ContentStudioLayout>
  )
}
