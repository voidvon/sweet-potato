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
import { t } from '@shared/i18n';

export const modules: ModuleItem[] = [
  {
    id: 'claw',
    title: t("图片创作"),
    subtitle: t("AI 生图工作台"),
    priority: 'P0',
    icon: ImagePlus,
    stats: [t("换背景"), t("模特换装"), t("细节增强"), t("高清放大")],
    description: t("支持参考图上传、多模型生图、效果图再生成和图片继续编辑。"),
  },
  {
    id: 'content',
    title: t("内容创作"),
    subtitle: t("短视频生产工具"),
    priority: 'P0',
    icon: FileVideo,
    stats: [t("文生视频"), t("图生视频"), t("AI数字人"), t("AI声音")],
    description: t("支持多模型视频生成、混剪、字幕、配乐和内容策划。"),
  },
  {
    id: 'account',
    title: t("账户中心"),
    subtitle: t("资源与计费管理"),
    priority: 'P0',
    icon: CircleUserRound,
    stats: [t("有效期"), t("算力余额"), t("账户设置"), t("充值")],
    description: t("展示账号信息、有效期、算力余额和安全设置入口。"),
  },
];
