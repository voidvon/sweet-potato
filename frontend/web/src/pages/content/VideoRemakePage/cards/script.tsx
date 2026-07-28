import { Input } from 'antd';
import { asRecord, fieldText } from '../videoRemakeCardUtils';
import { EditableCard } from './cardShell';
import { SummaryBlock, type CardRendererProps } from './shared';

export function ScriptCard(props: CardRendererProps) {
  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        return props.card.status === 'editing' ? (
          <div className="remake-card-fields">
            <label>口播/人声内容<Input.TextArea autoSize={{ minRows: 7 }} value={fieldText(data.content)} onChange={(event) => setDraft({ ...data, content: event.target.value })} /></label>
          </div>
        ) : (
          <SummaryBlock lines={fieldText(data.content)} emptyText="暂无口播内容。" />
        );
      }}
    </EditableCard>
  );
}
