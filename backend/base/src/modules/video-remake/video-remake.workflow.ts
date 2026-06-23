import type {
  VideoRemakeCardType,
  VideoRemakeTask,
  VideoRemakeWorkflowNode,
  VideoRemakeWorkflowState,
} from './video-remake.types.js';

export const directorStepToCardType: Record<string, VideoRemakeCardType> = {
  basic: 'basic_info',
  character: 'character_setting',
  scene: 'scene_setting',
  product: 'product_setting',
  pip: 'pip_setting',
  audio: 'voice_audio_setting',
  part: 'script_content',
  storyboard: 'storyboard_script',
  final: 'final_video',
};

export const cardTypeToDirectorStep: Partial<Record<VideoRemakeCardType, string>> = Object.fromEntries(
  Object.entries(directorStepToCardType).map(([step, cardType]) => [cardType, step]),
) as Partial<Record<VideoRemakeCardType, string>>;

export const cardTitles: Record<VideoRemakeCardType, string> = {
  uploading: '视频上传',
  video_basic_info: '视频基础信息',
  basic_info: '基础信息',
  expert_analysis: '专家解析',
  character_setting: '人物设定',
  scene_setting: '场景设定',
  product_setting: '产品设定',
  pip_setting: '画中画设定',
  voice_audio_setting: '人声/音频',
  script_content: '口播内容',
  storyboard_script: '分镜脚本',
  seedance_prompt: 'Seedance 提示词',
  generation_progress: '视频解析',
  director_normalize: '视频导演',
  llm_thinking: '大模型思考',
  final_video: '最终视频',
};

export const artifactDependencies: Record<VideoRemakeCardType, VideoRemakeCardType[]> = {
  uploading: [],
  video_basic_info: [],
  basic_info: ['storyboard_script', 'seedance_prompt'],
  expert_analysis: [
    'character_setting',
    'scene_setting',
    'product_setting',
    'pip_setting',
    'voice_audio_setting',
    'script_content',
    'storyboard_script',
    'seedance_prompt',
  ],
  character_setting: ['storyboard_script', 'seedance_prompt'],
  scene_setting: ['storyboard_script', 'seedance_prompt'],
  product_setting: ['storyboard_script', 'seedance_prompt'],
  pip_setting: ['storyboard_script', 'seedance_prompt'],
  voice_audio_setting: ['storyboard_script', 'seedance_prompt'],
  script_content: ['storyboard_script', 'seedance_prompt'],
  storyboard_script: ['seedance_prompt'],
  seedance_prompt: [],
  generation_progress: [],
  director_normalize: [],
  llm_thinking: [],
  final_video: [],
};

export const cardTypeToNode: Partial<Record<VideoRemakeCardType, VideoRemakeWorkflowNode>> = {
  basic_info: 'confirm_basic_info',
  character_setting: 'confirm_character',
  scene_setting: 'confirm_scene',
  product_setting: 'confirm_product',
  pip_setting: 'confirm_pip',
  voice_audio_setting: 'confirm_voice_audio',
  script_content: 'confirm_script_content',
  storyboard_script: 'confirm_storyboard',
  seedance_prompt: 'confirm_seedance_prompts',
  final_video: 'merge_video',
};

export const cardConfirmationOrder: VideoRemakeCardType[] = [
  'basic_info',
  'character_setting',
  'scene_setting',
  'product_setting',
  'pip_setting',
  'voice_audio_setting',
  'script_content',
];

export function workflowNodeOrder(): VideoRemakeWorkflowNode[] {
  return [
    'upload_to_vod',
    'analyze_audio',
    'analyze_visual',
    'analyze_pip',
    'director_normalize',
    'confirm_basic_info',
    'confirm_character',
    'confirm_scene',
    'confirm_product',
    'confirm_pip',
    'confirm_voice_audio',
    'confirm_script_content',
    'generate_storyboard',
    'confirm_storyboard',
    'generate_seedance_prompts',
    'confirm_seedance_prompts',
    'generate_video_segments',
    'merge_video',
    'completed',
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const presetAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
type PresetAspectRatio = typeof presetAspectRatios[number];

function nearestPresetAspectRatio(value: unknown) {
  const text = String(value || '').trim().replace(/\s+/gu, '');
  if (!text) {
    return '';
  }
  if (presetAspectRatios.includes(text as typeof presetAspectRatios[number])) {
    return text;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/u);
  if (!match) {
    return text;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return text;
  }
  const target = width / height;
  let best: PresetAspectRatio = presetAspectRatios[0];
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of presetAspectRatios) {
    const [presetWidth, presetHeight] = ratio.split(':').map(Number);
    const distance = Math.abs(target - (presetWidth / presetHeight));
    if (distance < smallestDistance) {
      smallestDistance = distance;
      best = ratio;
    }
  }
  return best;
}

export function remakeContext(task?: VideoRemakeTask) {
  const context = isRecord(task?.expertContext) ? task.expertContext : {};
  return isRecord(context.videoRemake) ? context.videoRemake : {};
}

export function remakeWorkflow(task?: VideoRemakeTask): VideoRemakeWorkflowState | undefined {
  const context = remakeContext(task);
  return isRecord(context.workflow) ? context.workflow as VideoRemakeWorkflowState : undefined;
}

export function remakeArtifacts(task?: VideoRemakeTask) {
  const workflow = remakeWorkflow(task);
  if (workflow) {
    return workflow.artifacts;
  }
  const context = remakeContext(task);
  return isRecord(context.artifacts) ? context.artifacts : {};
}

export function dataForCard(cardType: VideoRemakeCardType, input?: { task?: VideoRemakeTask; workflow?: VideoRemakeWorkflowState }) {
  const artifacts = input?.workflow?.artifacts || remakeArtifacts(input?.task);
  const videoBasicInfo = (artifacts.videoBasicInfo && typeof artifacts.videoBasicInfo === 'object' && !Array.isArray(artifacts.videoBasicInfo))
    ? artifacts.videoBasicInfo as Record<string, unknown>
    : {};
  switch (cardType) {
    case 'video_basic_info':
      return videoBasicInfo;
    case 'basic_info':
      return artifacts.basicInfo || {
        title: input?.task?.title || input?.workflow?.source.title || videoBasicInfo.title || '',
        resolution: videoBasicInfo.resolution || '720p',
        aspectRatio: nearestPresetAspectRatio(videoBasicInfo.aspectRatio) || '9:16',
      };
    case 'expert_analysis':
      return artifacts.expertAnalysis || {};
    case 'character_setting':
      return artifacts.characterSetting || {};
    case 'scene_setting':
      return artifacts.sceneSetting || {};
    case 'product_setting':
      return artifacts.productSetting || {};
    case 'pip_setting':
      return artifacts.pipSetting || {};
    case 'voice_audio_setting':
      return artifacts.voiceAudioSetting || {};
    case 'script_content':
      return artifacts.scriptContent || {};
    case 'storyboard_script':
      return artifacts.storyboardScript || [];
    case 'seedance_prompt':
      return artifacts.seedancePrompts || [];
    case 'generation_progress':
      return artifacts.generationProgress || {};
    case 'director_normalize':
      return artifacts.directorNormalize || {};
    case 'llm_thinking':
      return artifacts.llmThinking || {};
    case 'final_video':
      return artifacts.finalVideo || {};
    default:
      return {};
  }
}

export function artifactKeyForCard(cardType: VideoRemakeCardType) {
  const map: Partial<Record<VideoRemakeCardType, string>> = {
    video_basic_info: 'videoBasicInfo',
    basic_info: 'basicInfo',
    expert_analysis: 'expertAnalysis',
    character_setting: 'characterSetting',
    scene_setting: 'sceneSetting',
    product_setting: 'productSetting',
    pip_setting: 'pipSetting',
    voice_audio_setting: 'voiceAudioSetting',
    script_content: 'scriptContent',
    storyboard_script: 'storyboardScript',
    seedance_prompt: 'seedancePrompts',
    generation_progress: 'generationProgress',
    llm_thinking: 'llmThinking',
    final_video: 'finalVideo',
  };
  return map[cardType] || cardType;
}

export function nextCardToConfirm(current: VideoRemakeCardType) {
  const index = cardConfirmationOrder.indexOf(current);
  if (index < 0) {
    return cardConfirmationOrder[0];
  }
  return cardConfirmationOrder[index + 1];
}

export function nodeForNextConfirmation(current: VideoRemakeCardType) {
  const nextCard = nextCardToConfirm(current);
  return nextCard ? cardTypeToNode[nextCard] : undefined;
}
