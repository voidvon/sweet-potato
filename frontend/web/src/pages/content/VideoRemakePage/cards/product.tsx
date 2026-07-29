import { Button, Input, Radio } from 'antd';
import { useEffect, useState } from 'react';
import { asItems, asRecord, fieldBool, fieldText, updateAt } from '../videoRemakeCardUtils';
import { EditableCard, renderItemTabs } from './cardShell';
import { SquareReferencePicker, SummaryBlock, cleanReferencePromptText, compactLines, findSelectedAssets, selectedAssetIdsFromItem, type CardRendererProps } from './shared';

export function ProductCard(props: CardRendererProps) {
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
        const rawItems = asItems(data.items);
        const hasProductData = rawItems.length > 0 || Boolean(
          fieldText(data.description)
          || fieldText(data.presentation)
          || fieldText(data.groupId)
          || fieldText(data.assetId)
          || fieldText(data.productType)
          || fieldText(data.feature)
          || fieldText(data.label),
        );
        const items = rawItems.length ? rawItems : [hasProductData ? data : { label: '产品 1', noProduct: true, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const mode = fieldText(item.referenceMode) || fieldText(data.referenceMode) || 'prompt';
        const selectedAssetIds = selectedAssetIdsFromItem(item);
        const selectedAssets = findSelectedAssets(props.assets, selectedAssetIds);
        const noProduct = fieldBool(item.noProduct) || fieldBool(data.noProduct) || !hasProductData;
        const setItem = (patch: Record<string, unknown>) => {
          if (rawItems.length) {
            setDraft({ ...data, items: updateAt(items, index, patch) });
            return;
          }
          setDraft({ ...data, ...patch });
        };
        const addItem = () => {
          const nextBaseItems = rawItems.length ? items : [{ ...data, label: fieldText(data.label) || '产品 1' }];
          const nextItems = [...nextBaseItems, { label: `产品 ${nextBaseItems.length + 1}`, noProduct: false, referenceMode: 'prompt', manuallyAdded: true }];
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
          if (noProduct) {
            return <SummaryBlock lines="不需要产品" />;
          }
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '产品')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `产品 ${index + 1}`],
                  ['是否需要产品', fieldBool(item.noProduct) ? '不需要' : '需要'],
                  ['参考方式', (fieldText(item.referenceMode) || mode) === 'asset' ? '参考素材' : '参考提示词'],
                  ['产品素材', selectedAssetIds.length ? '已选择产品素材' : fieldText(item.groupId) ? '已选择产品组' : undefined],
                  ['产品描述', cleanReferencePromptText(item.description)],
                  ['展示方式', cleanReferencePromptText(item.presentation)],
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '产品', { addLabel: '+ 添加产品', onAdd: addItem })}
            <div className="remake-current-line">
              <span>当前：{fieldText(item.label) || `产品 ${index + 1}`}</span>
              {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
            </div>
            <label className="remake-radio-field">
              <span>是否需要产品</span>
              <Radio.Group
                options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                value={noProduct ? 'no' : 'yes'}
                onChange={(event) => setItem({ noProduct: event.target.value === 'no' })}
              />
            </label>
            {noProduct ? null : (
              <>
                <label className="remake-radio-field">
                  <span>产品设定参考</span>
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
                </label>
                {mode === 'asset' ? (
                  <label>
                    产品素材
                    <div className="remake-asset-field">
                      <SquareReferencePicker
                        asset={selectedAssets[0]}
                        assets={props.assets}
                        emptyText="点击选择产品素材"
                        group={undefined}
                        groups={[]}
                        onEnsureAssets={props.onEnsureAssets}
                        onClear={selectedAssetIds.length || fieldText(item.groupId) ? () => setItem({ groupId: '', assetId: '', assetIds: [] }) : undefined}
                        onSelect={(selection) => {
                          const nextId = fieldText(selection.assetId);
                          setItem({ groupId: '', assetId: nextId, assetIds: nextId ? [nextId] : [] });
                        }}
                        onUpload={props.onUploadReferenceImage ? async (file) => {
                          const asset = await props.onUploadReferenceImage?.('product', file);
                          if (!asset) {
                            return;
                          }
                          setItem({ groupId: '', assetId: asset.id, assetIds: [asset.id] });
                        } : undefined}
                        pickText="选择素材"
                        selectorKind="product_asset"
                        selectorTitle="选择产品素材"
                      />
                    </div>
                  </label>
                ) : null}
                <label>产品描述<Input.TextArea autoSize={{ minRows: 2 }} value={cleanReferencePromptText(item.description)} onChange={(event) => setItem({ description: event.target.value })} /></label>
                <label>展示方式<Input.TextArea autoSize={{ minRows: 2 }} value={cleanReferencePromptText(item.presentation)} onChange={(event) => setItem({ presentation: event.target.value })} /></label>
              </>
            )}
          </div>
        );
      }}
    </EditableCard>
  );
}
