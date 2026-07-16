import type { PlanningApplyPayload } from '../../../../api/content-planning';
import type { User } from '../../../../types';
import type {
  MarketingVideoConfig,
  MaterialKey,
  PromptPanel as PromptPanelKind,
  SelectedMaterials,
} from '../types';
import { PromptPanel } from './PromptPanel';

type MarketingVideoPanelProps = {
  config: MarketingVideoConfig;
  currentUser: User;
  onChange: (config: MarketingVideoConfig) => void;
  onExpand: () => void;
  onPlanningApply: (payload: PlanningApplyPayload) => void;
  onPanelChange: (panel: PromptPanelKind | null) => void;
  onPlaceholderFiles: (kind: MaterialKey, files: File[]) => void;
  onPromptChange: (prompt: string) => void;
  panel: PromptPanelKind | null;
  prompt: string;
  selectedMaterials: SelectedMaterials;
};

export function MarketingVideoPanel({
  config,
  currentUser,
  onChange,
  onExpand,
  onPlanningApply,
  onPanelChange,
  onPlaceholderFiles,
  onPromptChange,
  panel,
  prompt,
  selectedMaterials,
}: MarketingVideoPanelProps) {
  const updateField = <Key extends keyof MarketingVideoConfig>(
    field: Key,
    value: MarketingVideoConfig[Key],
  ) => onChange({ ...config, [field]: value });

  return (
    <div className="video-task-marketing-form">
      <label className="video-task-marketing-field">
        <span>商品名称</span>
        <input
          onChange={(event) => updateField('productName', event.target.value)}
          placeholder="例如：夏季防晒衣"
          type="text"
          value={config.productName}
        />
      </label>

      <label className="video-task-marketing-field">
        <span>商品类目</span>
        <input
          onChange={(event) => updateField('productCategory', event.target.value)}
          placeholder="例如：服饰 / 美妆 / 食品"
          type="text"
          value={config.productCategory}
        />
      </label>

      <label className="video-task-marketing-field">
        <span>核心卖点</span>
        <textarea
          onChange={(event) => updateField('sellingPoints', event.target.value)}
          placeholder="一行一个卖点"
          rows={4}
          value={config.sellingPoints}
        />
      </label>

      <PromptPanel
        currentUser={currentUser}
        onExpand={onExpand}
        onPlanningApply={onPlanningApply}
        onPanelChange={onPanelChange}
        onPlaceholderFiles={onPlaceholderFiles}
        onPromptChange={onPromptChange}
        panel={panel}
        placeholder="补充你希望生成或解析的方向，输入 @ 引用素材"
        prompt={prompt}
        selectedMaterials={selectedMaterials}
        showPlanning={false}
        title="提示词 / 要求"
      />
    </div>
  );
}
