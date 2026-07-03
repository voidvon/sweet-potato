import { Image, message, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { Plus, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { ChatAttachment } from '../../../types';

export type ClawReferenceGroupConfig = {
  key: string;
  label: string;
  maxCount?: number;
  required?: boolean;
};

type ClawReferenceGroupsProps = {
  groups: ClawReferenceGroupConfig[];
  groupedAttachments: Record<string, ChatAttachment[]>;
  onAddFiles: (group: ClawReferenceGroupConfig, files: File[]) => Promise<ChatAttachment[]>;
  onRemoveAttachment: (attachmentId: string) => void;
};

type ReferenceStackStyle = CSSProperties & {
  '--claw-reference-index'?: number;
  '--claw-reference-transform'?: string;
  '--claw-reference-z-index'?: number;
};

const unlimitedReferenceCount = Number.POSITIVE_INFINITY;
const maxVisiblePreviewCount = 5;
const previewStackWidth = 108;
const previewStackTransforms = [
  'translate(0px, 0px) rotate(-1deg)',
  'translate(7px, -3px) rotate(3deg)',
  'translate(14px, -6px) rotate(-3deg)',
  'translate(21px, -9px) rotate(3deg)',
  'translate(28px, -12px) rotate(-3deg)',
];

export function ClawReferenceGroups({
  groups,
  groupedAttachments,
  onAddFiles,
  onRemoveAttachment,
}: ClawReferenceGroupsProps) {
  function createPreviewStyle(index: number): ReferenceStackStyle {
    return {
      '--claw-reference-index': index,
      '--claw-reference-transform': previewStackTransforms[index],
      '--claw-reference-z-index': index + 1,
    };
  }

  async function handleReferenceUpload(group: ClawReferenceGroupConfig, files: File[]) {
    const currentCount = groupedAttachments[group.key]?.length || 0;
    const maxCount = group.maxCount ?? unlimitedReferenceCount;
    const remainingCount = maxCount - currentCount;
    if (remainingCount <= 0) {
      message.warning(`${group.label}最多上传 ${group.maxCount} 张`);
      return;
    }

    const acceptedFiles = files.slice(0, remainingCount);
    if (acceptedFiles.length < files.length && group.maxCount) {
      message.warning(`${group.label}最多上传 ${group.maxCount} 张`);
    }

    await onAddFiles(group, acceptedFiles);
  }

  function createReferenceUploadProps(group: ClawReferenceGroupConfig): UploadProps {
    return {
      accept: 'image/*',
      beforeUpload: (file, fileList) => {
        if (file.uid === fileList[0]?.uid) {
          void handleReferenceUpload(group, fileList);
        }
        return false;
      },
      multiple: group.maxCount !== 1,
      showUploadList: false,
    };
  }

  return (
    <div className="claw-reference-groups">
      {groups.map((group) => {
        const groupAttachments = groupedAttachments[group.key] || [];
        const maxCount = group.maxCount ?? unlimitedReferenceCount;
        const uploadDisabled = groupAttachments.length >= maxCount;
        const visibleAttachments = groupAttachments
          .map((attachment, index) => ({ attachment, number: index + 1 }))
          .slice(-maxVisiblePreviewCount);
        const hasAttachments = groupAttachments.length > 0;

        return (
          <div className={`claw-reference-group${hasAttachments ? ' has-attachments' : ''}`} key={group.key}>
            {!hasAttachments ? (
              <Upload {...createReferenceUploadProps(group)} disabled={uploadDisabled}>
                <button className="claw-reference-empty" disabled={uploadDisabled} type="button">
                  {!group.required ? (
                    <span className="claw-reference-badge">可选</span>
                  ) : null}
                  <Plus size={26} strokeWidth={1.6} />
                  <span className="claw-reference-label">{group.label}</span>
                </button>
              </Upload>
            ) : (
              <>
                <div
                  className="claw-reference-stack"
                  style={{
                    width: `${previewStackWidth}px`,
                  } as ReferenceStackStyle}
                >
                  {visibleAttachments.map(({ attachment, number }, index) => (
                    <span
                      className="claw-reference-preview"
                      key={attachment.id}
                      style={createPreviewStyle(index)}
                    >
                      <span className="claw-reference-card-shadow" />
                      <span className="claw-reference-image-frame">
                        {index === visibleAttachments.length - 1 ? (
                          <span className="claw-reference-image-index">图{number}</span>
                        ) : null}
                        {index === visibleAttachments.length - 1 ? (
                          <button
                            aria-label={`移除 ${attachment.name}`}
                            onClick={() => onRemoveAttachment(attachment.id)}
                            type="button"
                          >
                            <X size={10} />
                          </button>
                        ) : null}
                      </span>
                      <span className="claw-reference-image-mask">
                        <Image
                          alt={attachment.name}
                          className="claw-reference-image"
                          preview={false}
                          src={attachment.url}
                        />
                      </span>
                    </span>
                  ))}
                </div>
                {!uploadDisabled ? (
                  <Upload {...createReferenceUploadProps(group)} disabled={uploadDisabled}>
                    <button aria-label={`继续上传${group.label}`} className="claw-reference-add" type="button">
                      <Plus size={18} strokeWidth={1.6} />
                    </button>
                  </Upload>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
