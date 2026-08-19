import {
  ChartNoAxesCombined,
  CircleUserRound,
  FileVideo,
  Globe2,
  Headphones,
  ImagePlus,
  RadioTower,
  Workflow,
} from 'lucide-react';
import type { ModuleItem } from './types';

export const modules: ModuleItem[] = [
  {
    id: 'claw',
    title: '图片创作',
    subtitle: 'AI 生图工作台',
    priority: 'P0',
    icon: ImagePlus,
    stats: ['换背景', '模特换装', '细节增强', '高清放大'],
    description: '支持参考图上传、多模型生图、效果图再生成和图片继续编辑。',
  },
  {
    id: 'content',
    title: '内容创作',
    subtitle: '短视频生产工具',
    priority: 'P0',
    icon: FileVideo,
    stats: ['文生视频', '图生视频', 'AI数字人', 'AI声音'],
    description: '支持多模型视频生成、混剪、字幕、配乐和内容策划。',
  },
  {
    id: 'account',
    title: '账户中心',
    subtitle: '资源与计费管理',
    priority: 'P0',
    icon: CircleUserRound,
    stats: ['有效期', '算力余额', '账户设置', '充值'],
    description: '展示账号信息、有效期、算力余额和安全设置入口。',
  },
];
