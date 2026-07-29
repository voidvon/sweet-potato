import type { ReactElement } from 'react';
import type { VideoRemakeCardType } from '../../../api/video-remake';
import { ExpertAnalysisCard } from './cards/analysis';
import { AudioCard } from './cards/audio';
import { BasicInfoCard } from './cards/basic';
import { CharacterCard } from './cards/character';
import { FinalVideoCard } from './cards/finalVideo';
import { PipCard } from './cards/pip';
import { ProductCard } from './cards/product';
import { DirectorNormalizeCard, GenerationProgressCard, LlmThinkingCard } from './cards/progress';
import { SceneCard } from './cards/scene';
import { ScriptCard } from './cards/script';
import { SeedanceCard } from './cards/seedance';
import { StatusCard, VideoBasicInfoCard } from './cards/status';
import { StoryboardCard } from './cards/storyboard';
import type { CardRendererProps } from './cards/types';

export const cardRegistry: Record<VideoRemakeCardType, (props: CardRendererProps) => ReactElement> = {
  uploading: StatusCard,
  video_basic_info: VideoBasicInfoCard,
  basic_info: BasicInfoCard,
  expert_analysis: ExpertAnalysisCard,
  character_setting: CharacterCard,
  scene_setting: SceneCard,
  product_setting: ProductCard,
  pip_setting: PipCard,
  voice_audio_setting: AudioCard,
  script_content: ScriptCard,
  storyboard_script: StoryboardCard,
  seedance_prompt: SeedanceCard,
  generation_progress: GenerationProgressCard,
  director_normalize: DirectorNormalizeCard,
  llm_thinking: LlmThinkingCard,
  final_video: FinalVideoCard,
};

export function renderVideoRemakeCard(props: CardRendererProps) {
  const Renderer = cardRegistry[props.card.cardType];
  return <Renderer {...props} />;
}
