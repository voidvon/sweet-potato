import { Button, Input, InputNumber, Radio, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { asItems, asRecord, fieldBool, fieldText, mediaUrl, updateAt } from '../videoRemakeCardUtils';
import { EditableCard, renderItemTabs } from './cardShell';
import { SummaryBlock, compactLines, type CardRendererProps } from './shared';

export function PipCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const data = asRecord(props.card.data);
    const items = asItems(data.items);
    const focusIndex = Number(data.activeItemIndex);
    setActiveIndex(Number.isFinite(focusIndex) && focusIndex >= 0
      ? Math.min(focusIndex, Math.max(0, items.length - 1))
      : 0);
  }, [props.card.cardId]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ id: 'pip_1', label: '画中画 1', required: false, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const pipPrompt = fieldText(item.replacementPrompt) || fieldText(item.content);
        const videoDuration = Math.max(0, Math.floor(Number(props.videoDurationSeconds || 0)));
        const uploadedImageUrl = fieldText(item.replacementAssetUrl || item.fileUrl);
        const uploadedImageName = fieldText(item.replacementAssetName || item.originalFileName || item.storedFileName);
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [...items, { id: `pip_${items.length + 1}`, label: `画中画 ${items.length + 1}`, required: true, referenceMode: 'asset', manuallyAdded: true }];
          setDraft({ ...data, items: nextItems });
          setActiveIndex(nextItems.length - 1);
        };
        const removeItem = () => {
          if (items.length <= 1) {
            return;
          }
          const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
          setDraft({ ...data, items: nextItems });
          setActiveIndex(Math.min(index, nextItems.length - 1));
        };

        if (props.card.status !== 'editing') {
          if (item.required === false && !items.some((entry) => entry.required !== false)) {
            return <SummaryBlock lines="不需要画中画" />;
          }
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '画中画')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `画中画 ${index + 1}`],
                  ['是否需要', item.required === false ? '不需要' : '需要'],
                  ['出现时间', fieldText(item.startSecond) || fieldText(item.endSecond) ? `${fieldText(item.startSecond) || '?'}s - ${fieldText(item.endSecond) || '?'}s` : undefined],
                  ['位置', fieldText(item.position)],
                  ['图片素材', uploadedImageName || (uploadedImageUrl ? '已上传图片' : undefined)],
                  ['画中画描述提示词', pipPrompt],
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '画中画', { addLabel: '+ 添加画中画', onAdd: addItem })}
            <div className="remake-current-line">
              <span>当前：{fieldText(item.label) || `画中画 ${index + 1}`}</span>
              {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
            </div>
            <label className="remake-radio-field">
              <span>是否需要此画中画</span>
              <Radio.Group
                options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                value={item.required === false ? 'no' : 'yes'}
                onChange={(event) => setItem({ required: event.target.value !== 'no' })}
              />
            </label>
            {item.required === false ? null : (
              <>
                <div className="remake-card-fields three">
                  <label>
                    开始时间（秒）
                    <InputNumber
                      controls
                      min={0}
                      max={videoDuration ? Math.max(0, videoDuration - 1) : undefined}
                      precision={0}
                      value={Number.isFinite(Number(item.startSecond)) ? Number(item.startSecond) : null}
                      onChange={(value) => setItem({ startSecond: value ?? '' })}
                    />
                  </label>
                  <label>
                    结束时间（秒）
                    <InputNumber
                      controls
                      min={0}
                      max={videoDuration ? Math.max(0, videoDuration - 1) : undefined}
                      precision={0}
                      value={Number.isFinite(Number(item.endSecond)) ? Number(item.endSecond) : null}
                      onChange={(value) => setItem({ endSecond: value ?? '' })}
                    />
                  </label>
                  <label>大致位置<Input value={fieldText(item.position)} onChange={(event) => setItem({ position: event.target.value })} /></label>
                </div>
                <label>
                  画中画图片素材
                  <div className="remake-asset-field">
                    {uploadedImageUrl ? (
                      <div className="remake-selected-reference">
                        <div className="remake-selected-thumb">
                          <img src={mediaUrl(uploadedImageUrl)} alt={uploadedImageName || '画中画图片'} />
                        </div>
                        <div className="remake-selected-info">
                          <strong>{uploadedImageName || '已上传图片'}</strong>
                          <small>图片素材</small>
                        </div>
                      </div>
                    ) : (
                      <span>未上传图片</span>
                    )}
                    <div className="remake-asset-actions">
                      {uploadedImageUrl ? <Button size="small" onClick={() => setItem({ replacementAssetUrl: '', replacementAssetName: '', replacementAssetMimeType: '', replacementAssetType: '', replacementAssetStorageProvider: '', replacementAssetStorageKey: '', replacementAssetStorageBucket: '' })}>清除</Button> : null}
                      <Upload
                        accept="image/*"
                        beforeUpload={(file) => {
                          if (!file.type.startsWith('image/')) {
                            return Upload.LIST_IGNORE;
                          }
                          void props.onUploadPipImage?.(file).then((result) => {
                            setItem({
                              referenceMode: 'asset',
                              replacementAssetUrl: result.fileUrl,
                              replacementAssetName: result.originalFileName,
                              replacementAssetMimeType: result.mimeType,
                              replacementAssetSize: result.fileSize,
                              replacementAssetType: 'image',
                              replacementAssetStorageProvider: result.storageProvider,
                              replacementAssetStorageKey: result.storageKey,
                              replacementAssetStorageBucket: result.storageBucket,
                            });
                          });
                          return Upload.LIST_IGNORE;
                        }}
                        maxCount={1}
                        showUploadList={false}
                      >
                        <Button size="small">上传图片</Button>
                      </Upload>
                    </div>
                  </div>
                </label>
                <label>画中画描述提示词<Input.TextArea autoSize={{ minRows: 3 }} value={pipPrompt} onChange={(event) => setItem({ replacementPrompt: event.target.value })} /></label>
              </>
            )}
          </div>
        );
      }}
    </EditableCard>
  );
}
