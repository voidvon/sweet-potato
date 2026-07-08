import { Image, message, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { ArrowRightLeft, Plus, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { ChatAttachment } from '../../../types';
import { resolveAssetUrl } from '../../../api/request';
import { ImageAttachmentStack } from './ImageAttachmentStack';

export type ClawReferenceGroupConfig = {
  key: string;
  label: string;
  maxCount?: number;
  required?: boolean;
};

type ClawReferenceGroupsProps = {
  className?: string;
  groups: ClawReferenceGroupConfig[];
  groupedAttachments: Record<string, ChatAttachment[]>;
  onAddFiles?: (group: ClawReferenceGroupConfig, files: File[]) => Promise<ChatAttachment[]>;
  onRemoveAttachment?: (attachmentId: string) => void;
  readonly?: boolean;
};

const unlimitedReferenceCount = Number.POSITIVE_INFINITY;

export function ClawReferenceGroups({
  className,
  groups,
  groupedAttachments,
  onAddFiles,
  onRemoveAttachment,
  readonly = false,
}: ClawReferenceGroupsProps) {
  const [previewImageGroup, setPreviewImageGroup] = useState<{
    current: number;
    images: ChatAttachment[];
    open: boolean;
  }>({
    current: 0,
    images: [],
    open: false,
  });

  async function handleReferenceUpload(group: ClawReferenceGroupConfig, files: File[]) {
    if (!onAddFiles) {
      return;
    }
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
    <div className={['claw-reference-groups', groups.length === 2 ? 'is-pair' : '', className].filter(Boolean).join(' ')}>
      {groups.map((group, groupIndex, groupItems) => {
        const groupAttachments = groupedAttachments[group.key] || [];
        const showGroupBridge = groupItems.length === 2 && groupIndex === 1;
        const startIndex = groupItems
          .slice(0, groupIndex)
          .reduce((total, item) => total + (groupedAttachments[item.key]?.length || 0), 1);
        const maxCount = group.maxCount ?? unlimitedReferenceCount;
        const uploadDisabled = groupAttachments.length >= maxCount;
        const hasAttachments = groupAttachments.length > 0;

        return (
          <Fragment key={group.key}>
            {showGroupBridge ? (
              <span aria-hidden="true" className="claw-reference-group-bridge">
                <ArrowRightLeft size={18} strokeWidth={1.8} />
              </span>
            ) : null}
            <div className={`claw-reference-group${hasAttachments ? ' has-attachments' : ''}`}>
              {!hasAttachments && !readonly ? (
                <Upload {...createReferenceUploadProps(group)} disabled={uploadDisabled}>
                  <button className="claw-reference-empty" disabled={uploadDisabled} type="button">
                    {!group.required ? (
                      <span className="claw-reference-badge">可选</span>
                    ) : null}
                    <Plus size={26} strokeWidth={1.6} />
                    <span className="claw-reference-label">{group.label}</span>
                  </button>
                </Upload>
              ) : null}
              {hasAttachments ? (
                <>
                  <ImageAttachmentStack
                    attachments={groupAttachments}
                    onPreview={(_attachment, index) => setPreviewImageGroup({
                      current: index,
                      images: groupAttachments,
                      open: true,
                    })}
                    renderTopAction={readonly || !onRemoveAttachment ? undefined : (attachment) => (
                      <button
                        aria-label={`移除 ${attachment.name}`}
                        className="claw-reference-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveAttachment(attachment.id);
                        }}
                        type="button"
                      >
                        <X size={10} />
                      </button>
                    )}
                    startIndex={startIndex}
                  />
                  {!uploadDisabled && !readonly ? (
                    <Upload {...createReferenceUploadProps(group)} disabled={uploadDisabled}>
                      <button aria-label={`继续上传${group.label}`} className="claw-reference-add" type="button">
                        <Plus size={18} strokeWidth={1.6} />
                      </button>
                    </Upload>
                  ) : null}
                </>
              ) : null}
            </div>
          </Fragment>
        );
      })}
      <Image.PreviewGroup
        items={previewImageGroup.images.map((attachment) => ({
          alt: attachment.name,
          src: resolveAssetUrl(attachment.url),
        }))}
        preview={{
          current: previewImageGroup.current,
          open: previewImageGroup.open,
          onChange: (current) => {
            setPreviewImageGroup((group) => ({
              ...group,
              current,
            }));
          },
          onOpenChange: (open, info) => {
            setPreviewImageGroup((group) => ({
              ...group,
              current: info.current ?? group.current,
              open,
            }));
          },
        }}
      />
    </div>
  );
}
