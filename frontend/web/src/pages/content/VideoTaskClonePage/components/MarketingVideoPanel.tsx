import { Input } from 'antd';
import type { PlanningApplyPayload } from '../../../../api/content-planning';
import type { User } from '../../../../types';
import type {
  MarketingVideoConfig,
  MaterialKey,
  PromptPanel as PromptPanelKind,
  SelectedMaterials,
} from '../types';
import { PromptPanel } from './PromptPanel';
import { WorkspaceSection } from './WorkspaceSection';

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
      <WorkspaceSection
        className="video-task-marketing-field"
        title={<label htmlFor="marketing-product-name">商品名称</label>}
        variant="plain"
      >
        <Input
          id="marketing-product-name"
          onChange={(event) => updateField('productName', event.target.value)}
          placeholder="例如：夏季防晒衣"
          size="large"
          value={config.productName}
        />
      </WorkspaceSection>

      <WorkspaceSection
        className="video-task-marketing-field"
        title={<label htmlFor="marketing-product-category">商品类目</label>}
        variant="plain"
      >
        <Input
          id="marketing-product-category"
          onChange={(event) => updateField('productCategory', event.target.value)}
          placeholder="例如：服饰 / 美妆 / 食品"
          size="large"
          value={config.productCategory}
        />
      </WorkspaceSection>

      <WorkspaceSection
        className="video-task-marketing-field"
        title={<label htmlFor="marketing-selling-points">核心卖点</label>}
        variant="plain"
      >
        <Input.TextArea
          id="marketing-selling-points"
          onChange={(event) => updateField('sellingPoints', event.target.value)}
          placeholder="一行一个卖点"
          rows={4}
          size="large"
          value={config.sellingPoints}
        />
      </WorkspaceSection>

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
