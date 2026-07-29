import { Select } from 'antd';
import { asRecord, fieldText } from '../videoRemakeCardUtils';
import { EditableCard } from './cardShell';
import { SummaryBlock, compactLines, nearestPresetAspectRatio, normalizeResolution, type CardRendererProps } from './shared';

export function BasicInfoCard(props: CardRendererProps) {
  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const resolution = normalizeResolution(data.resolution, data.resolutionDetail, data.aspectRatio);
        return props.card.status === 'editing' ? (
          <div className="remake-card-fields two">
            <label>
              分辨率
              <Select
                options={['480p', '720p', '1080p'].map((value) => ({ label: value, value }))}
                placeholder="请选择分辨率"
                value={resolution || undefined}
                onChange={(value) => setDraft({ ...data, resolution: value })}
              />
            </label>
            <label>
              宽高比
              <Select
                options={['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].map((value) => ({ label: value, value }))}
                placeholder="请选择宽高比"
                value={nearestPresetAspectRatio(data.aspectRatio) || undefined}
                onChange={(value) => setDraft({ ...data, aspectRatio: value })}
              />
            </label>
          </div>
        ) : (
          <SummaryBlock
            lines={compactLines([
              ['分辨率', normalizeResolution(data.resolution, data.resolutionDetail, data.aspectRatio)],
              ['宽高比', fieldText(data.aspectRatio)],
            ])}
          />
        );
      }}
    </EditableCard>
  );
}
