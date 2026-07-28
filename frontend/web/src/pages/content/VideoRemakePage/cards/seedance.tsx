import { Alert } from 'antd';
import { useEffect, useState } from 'react';
import { MentionRichTextarea } from '../../../../components/MentionRichTextarea';
import { asItems, asRecord, fieldText, updateAt } from '../videoRemakeCardUtils';
import { EditableCard, renderItemTabs } from './cardShell';
import { SeedancePromptPreview, formatShotTime, maxSegmentDurationText, promptTextValue, seedanceMentionOptions, seedanceReferenceMentions, totalDurationText, type CardRendererProps } from './shared';

export function SeedanceCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const draftRecord = asRecord(draft);
        const directSegments = asItems(draft);
        const wrappedSegments = asItems(draftRecord.items);
        const promptSegments = asItems(draftRecord.prompts);
        const previousSegments = asItems(draftRecord.previousData);
        const generatedSegments = asItems(draftRecord.segments);
        const fallbackSegments = [
          ...previousSegments,
          ...generatedSegments,
          ...promptSegments,
        ];
        const segments = directSegments.length ? directSegments : wrappedSegments.length ? wrappedSegments : fallbackSegments;
        if (!segments.length) {
          return <Alert message="提示词生成中，请稍后。" showIcon type="info" />;
        }
        const index = Math.min(activeIndex, segments.length - 1);
        const segment = segments[index] || {};
        const prompt = asRecord(segment.prompt);
        const mentionOptions = seedanceReferenceMentions(prompt, props.assets);
        const setPrompt = (patch: Record<string, unknown>) => {
          const updatedSegments = updateAt(segments, index, { prompt: { ...prompt, ...patch } });
          setDraft(directSegments.length
            ? updatedSegments
            : wrappedSegments.length
              ? { ...draftRecord, items: updatedSegments }
              : promptSegments.length
                ? { ...draftRecord, prompts: updatedSegments }
                : { ...draftRecord, previousData: updatedSegments });
        };
        const mainPrompt = promptTextValue(prompt);
        const videoAspectRatio = fieldText(props.videoAspectRatio) || '9:16';
        const overview = [
          ['视频比例', videoAspectRatio],
          ['总时长', totalDurationText(segments)],
          ['分段数量', `${segments.length}`],
          ['单段限制', maxSegmentDurationText(segments)],
        ];

        if (props.card.status !== 'editing') {
          const previewIndex = Math.min(activeIndex, segments.length - 1);
          const previewSegment = segments[previewIndex] || {};
          const previewPrompt = asRecord(previewSegment.prompt);
          const previewTime = formatShotTime(previewSegment);
          return (
            <div className="remake-seedance">
              <div className="remake-seedance-overview">
                {overview.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
              </div>
              {renderItemTabs(segments.map((item, itemIndex) => ({ ...item, label: `分段 ${itemIndex + 1}` })), previewIndex, setActiveIndex, '分段')}
              <div className="remake-seedance-workbench">
                <section className="remake-seedance-preview-panel">
                  <header>
                    <div>
                      <span>当前预览</span>
                      <strong>分段 {previewIndex + 1}</strong>
                    </div>
                    {previewTime ? <time>{previewTime}</time> : null}
                  </header>
                  <SeedancePromptPreview mentions={seedanceReferenceMentions(previewPrompt, props.assets)} text={promptTextValue(previewPrompt)} />
                </section>
              </div>
            </div>
          );
        }

        return (
          <div className="remake-card-fields remake-seedance">
            <div className="remake-seedance-overview">
              {overview.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
            </div>
            {renderItemTabs(segments.map((item, itemIndex) => ({ ...item, label: `分段 ${itemIndex + 1}` })), index, setActiveIndex, '分段')}
            <div className="remake-seedance-workbench">
              <section className="remake-seedance-preview-panel remake-seedance-editor-panel">
                <header>
                  <div>
                    <span>正在编辑</span>
                    <strong>分段 {index + 1}</strong>
                  </div>
                  {formatShotTime(segment) ? <time>{formatShotTime(segment)}</time> : null}
                </header>
                <div className="remake-prompt-editor">
                  <label>提示词</label>
                  <MentionRichTextarea
                    disabled={props.disabled}
                    onChange={(value) => setPrompt({ mainPrompt: value })}
                    options={seedanceMentionOptions(mentionOptions)}
                    value={mainPrompt}
                  />
                </div>
              </section>
            </div>
          </div>
        );
      }}
    </EditableCard>
  );
}
