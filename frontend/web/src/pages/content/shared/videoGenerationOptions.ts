export const videoModelDefinitions = [
  {
    description: '适合画面表现、音画生成和通用短视频创作。',
    id: 'doubao-seedance-2-0-260128',
    label: 'Seedance 2.0',
  },
  {
    description: '适合更快出片和高频尝试。',
    id: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
  },
  {
    description: '更轻量的 Seedance 档位，适合海量短片快速产出。',
    id: 'doubao-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
  },
] as const

export const preferredVideoModelId = videoModelDefinitions[0].id

export const modelOptions = videoModelDefinitions.map((option) => option.label)
export const modelDescriptions = Object.fromEntries(
  videoModelDefinitions.map((option) => [option.label, option.description]),
) as Record<string, string>
export const modelOptionIds = Object.fromEntries(
  videoModelDefinitions.map((option) => [option.label, option.id]),
) as Record<string, string>

export const ratioOptions = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']

export const qualityOptions = [
  { label: '480P', description: '更快出片，适合草稿预览。' },
  { label: '720P', description: '更清晰，适合常规发布。' },
]

export const durationOptions = ['4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s']

export const danceRemakeModeOptions = [
  { description: '轻量视频复刻。', label: '标准模式', value: 'standard' },
  { description: '动作、镜头和节奏复刻更强。', label: '增强模式', value: 'enhanced' },
] as const

export const danceRemakeDefaults = {
  mode: 'standard',
  preserveAudio: true,
  quality: '720P',
  videoModelId: preferredVideoModelId,
} as const
