import { Button, Input, Radio } from 'antd';
import { useEffect, useState } from 'react';
import { AppForm } from '../../../../components/AppForm';
import { asItems, asRecord, fieldBool, fieldText, updateAt } from '../videoRemakeCardUtils';
import { EditableCard, renderItemTabs } from './cardShell';
import { SquareReferencePicker, SummaryBlock, cleanReferencePromptText, compactLines, findSelectedAssets, selectedAssetIdsFromItem, type CardRendererProps } from './shared';

export function SceneCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && (JSON.stringify(props.card.data).includes('groupId') || JSON.stringify(props.card.data).includes('assetId') || JSON.stringify(props.card.data).includes('assetIds'))) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ label: '场景 1', required: true, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const mode = fieldText(item.referenceMode) || 'prompt';
        const selectedAssetIds = selectedAssetIdsFromItem(item);
        const selectedAssets = findSelectedAssets(props.assets, selectedAssetIds);
        const hasSelectedAssetReference = selectedAssetIds.length > 0 || Boolean(fieldText(item.groupId));
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [...items, { label: `场景 ${items.length + 1}`, required: true, referenceMode: 'prompt', manuallyAdded: true }];
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
          const sceneRequired = item.required !== false;
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '场景')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `场景 ${index + 1}`],
                  ['是否需要', sceneRequired ? '需要' : '不需要'],
                  ...(sceneRequired ? [
                    ['参考方式', (fieldText(item.referenceMode) || (hasSelectedAssetReference ? 'asset' : 'prompt')) === 'asset' ? '参考素材' : '参考提示词'],
                    ['场景素材', hasSelectedAssetReference ? '已选择场景素材' : undefined],
                    ['场景描述', cleanReferencePromptText(item.description)],
                  ] as Array<[string, string | undefined]> : []),
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '场景', { addLabel: '+ 添加场景', onAdd: addItem })}
            <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
              <AppForm.Item label="当前">
                <div className="remake-current-line">
                  <span>{fieldText(item.label) || `场景 ${index + 1}`}</span>
                  {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
                </div>
              </AppForm.Item>
              <AppForm.Item className="remake-radio-field" label="是否需要此场景">
                <Radio.Group
                  options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                  value={item.required === false ? 'no' : 'yes'}
                  onChange={(event) => setItem({ required: event.target.value !== 'no' })}
                />
              </AppForm.Item>
              {item.required === false ? null : (
                <>
                  <AppForm.Item className="remake-radio-field" label="场景设定参考">
                    <Radio.Group
                      options={[{ label: '参考素材', value: 'asset' }, { label: '参考提示词', value: 'prompt' }]}
                      value={mode}
                      onChange={(event) => setItem({
                        referenceMode: event.target.value,
                        groupId: event.target.value === 'prompt' ? '' : (selectedAssetIds.length ? '' : item.groupId),
                        assetId: event.target.value === 'prompt' ? '' : item.assetId,
                        assetIds: event.target.value === 'prompt' ? [] : selectedAssetIds,
                      })}
                    />
                  </AppForm.Item>
                  {mode === 'asset' ? (
                    <AppForm.Item label="场景素材">
                      <SquareReferencePicker
                        asset={selectedAssets[0]}
                        assets={props.assets}
                        emptyText="点击选择场景素材"
                        group={undefined}
                        groups={[]}
                        onEnsureAssets={props.onEnsureAssets}
                        onClear={hasSelectedAssetReference ? () => setItem({ groupId: '', assetId: '', assetIds: [] }) : undefined}
                        onSelect={(selection) => {
                          const nextId = fieldText(selection.assetId);
                          setItem({ groupId: '', assetId: nextId, assetIds: nextId ? [nextId] : [] });
                        }}
                        onUpload={props.onUploadReferenceImage ? async (file) => {
                          const asset = await props.onUploadReferenceImage?.('scene', file);
                          if (!asset) {
                            return;
                          }
                          setItem({ groupId: '', assetId: asset.id, assetIds: [asset.id] });
                        } : undefined}
                        pickText="选择素材"
                        selectorKind="scene_asset"
                        selectorTitle="选择场景素材"
                      />
                    </AppForm.Item>
                  ) : null}
                  <AppForm.Item label="场景描述">
                    <Input.TextArea autoSize={{ minRows: 3 }} value={cleanReferencePromptText(item.description)} onChange={(event) => setItem({ description: event.target.value })} />
                  </AppForm.Item>
                </>
              )}
            </AppForm>
          </div>
        );
      }}
    </EditableCard>
  );
}
