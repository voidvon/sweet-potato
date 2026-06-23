import {
  Bot,
  ChartNoAxesCombined,
  CircleUserRound,
  FileVideo,
  Globe2,
  Headphones,
  RadioTower,
  Workflow,
} from 'lucide-react';
import type { ModuleItem } from './types';

export const modules: ModuleItem[] = [
  {
    id: 'claw',
    title: 'AI 对话',
    subtitle: '智能获客引擎',
    priority: 'P0',
    icon: Bot,
    stats: ['接待人数', '转换人数', '曝光私信', '添加好友'],
    description: '关键词曝光、定向曝光、主动互动、自动加好友和私域承接。',
  },
  {
    id: 'content',
    title: '内容创作',
    subtitle: '短视频生产工具',
    priority: 'P0',
    icon: FileVideo,
    stats: ['文生视频', '图生视频', 'AI数字人', 'AI声音'],
    description: '支持多模型视频生成、混剪、字幕、配乐和爆款分析。',
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
