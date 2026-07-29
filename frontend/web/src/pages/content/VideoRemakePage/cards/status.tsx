import { asRecord, fieldText } from '../videoRemakeCardUtils';
import { ReadonlyCard, renderStatusSummary } from './cardShell';
import { normalizeResolution, type CardRendererProps } from './shared';

export function StatusCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const status = fieldText(data.status);
  const message = renderStatusSummary(props.card);
  const isUploaded = status === 'uploaded' || props.card.status === 'confirmed';
  const displayMessage = isUploaded && message.includes('正在读取基础信息')
    ? '视频已上传完成，基础信息已读取完成。'
    : message;
  return (
    <ReadonlyCard>
      <div className="remake-status-bubble remake-upload-bubble">
        <p>{displayMessage || (isUploaded ? '视频已上传完成，基础信息已读取完成。' : '正在上传视频，请稍候...')}</p>
        {!isUploaded ? (
          <div className="remake-progress-detail">
            <div className="remake-progress-track"><i style={{ width: '68%' }} /></div>
          </div>
        ) : null}
      </div>
    </ReadonlyCard>
  );
}
export function VideoBasicInfoCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const lines = [
    // ['文件名', fieldText(data.fileName) || fieldText(data.title)],
    ['分辨率', normalizeResolution(data.resolution, data.resolutionDetail, data.aspectRatio)],
    ['宽高比', fieldText(data.aspectRatio)],
    ['视频时长', fieldText(data.duration)],
  ].filter(([, value]) => value);
  return (
    <ReadonlyCard>
      <div className="remake-video-basic">
        <ul>
          {lines.map(([label, value]) => (
            <li key={label}>
              <span>{label}：</span>
              <strong>{value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </ReadonlyCard>
  );
}
