import { Alert, Button } from 'antd';
import { asRecord, fieldText } from '../videoRemakeCardUtils';
import { EditableCard } from './cardShell';
import { formatShotTime, hasVisiblePipText, sanitizePipPreviewText, type CardRendererProps } from './shared';

export function StoryboardCard(props: CardRendererProps) {
  return (
    <EditableCard {...props}>
      {({ draft }) => {
        const data = asRecord(draft);
        const isRegenerating = fieldText(data.status) === 'regenerating';
        const displayDraft = draft;
        if (props.card.status === 'pending' && isRegenerating) {
          return <Alert message={fieldText(data.message) || '分镜脚本重新解析中，请稍候。'} showIcon type="info" />;
        }
        if (props.card.status === 'pending' && !Array.isArray(displayDraft)) {
          return <Alert message={fieldText(data.message) || '分镜脚本分析中，请稍候。'} showIcon type="info" />;
        }
        if (props.card.status === 'failed' || fieldText(data.status) === 'failed') {
          return (
            <div className="remake-card-fields">
              <Alert
                description={fieldText(data.errorMessage)}
                message={fieldText(data.message) || '分镜脚本生成失败，请稍后重试。'}
                showIcon
                type="error"
              />
              <div className="remake-card-actions-inline">
                <Button disabled={props.disabled} onClick={() => void props.onRegenerate?.()} type="primary">
                  重新生成分镜
                </Button>
              </div>
            </div>
          );
        }
        const shots = Array.isArray(displayDraft) ? displayDraft.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
        if (!shots.length) {
          return <Alert message="分镜脚本生成中，请稍后。" showIcon type="info" />;
        }
        return (
          <div className="remake-storyboard-list">
            {isRegenerating ? (
              <Alert message={fieldText(data.message) || '分镜脚本重新解析中，请稍候。'} showIcon type="info" />
            ) : null}
            {shots.map((shot, index) => {
              const pipText = sanitizePipPreviewText(fieldText(shot.pipDescription));
              return (
                <section className="remake-storyboard-shot" key={fieldText(shot.shotId) || index}>
                  <header>
                    <strong>{fieldText(shot.label) || `镜头 ${index + 1}`}</strong>
                    <span>{formatShotTime(shot)}</span>
                  </header>
                  <ul className="remake-storyboard-points">
                    {fieldText(shot.visualDescription) ? <li><b>画面：</b>{fieldText(shot.visualDescription)}</li> : null}
                    {fieldText(shot.actionDescription) ? <li><b>人物/动作：</b>{fieldText(shot.actionDescription)}</li> : null}
                    {fieldText(shot.narration) ? <li><b>台词/旁白：</b>{fieldText(shot.narration)}</li> : null}
                    {fieldText(shot.soundEffect) ? <li><b>音效：</b>{fieldText(shot.soundEffect)}</li> : null}
                    {hasVisiblePipText(pipText) ? <li><b>画中画：</b>{pipText}</li> : null}
                    {fieldText(shot.remakeSuggestion) ? <li><b>复刻建议：</b>{fieldText(shot.remakeSuggestion)}</li> : null}
                    {!fieldText(shot.visualDescription) && !fieldText(shot.narration) ? <li><b>画面：</b>按已确认素材和口播节奏生成。</li> : null}
                  </ul>
                </section>
              );
            })}
          </div>
        );
      }}
    </EditableCard>
  );
}
