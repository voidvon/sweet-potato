import { Button, Input, Radio } from 'antd';
import { useEffect, useState } from 'react';
import { AppForm } from '../../../../components/AppForm';
import { asItems, asRecord, fieldBool, fieldText, updateAt } from '../videoRemakeCardUtils';
import { EditableCard, renderItemTabs } from './cardShell';
import { SquareReferencePicker, SummaryBlock, characterDisplayPromptText, cleanReferencePromptText, compactLines, findSelectedAsset, findSelectedGroup, type CardRendererProps } from './shared';

export function CharacterCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && JSON.stringify(props.card.data).includes('assetId')) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ label: '人物 1', required: true, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const mode = fieldText(item.referenceMode) || 'prompt';
        const hasSelectedAssetReference = Boolean(fieldText(item.assetId) || fieldText(item.groupId));
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [...items, { label: `人物 ${items.length + 1}`, required: true, referenceMode: 'prompt', manuallyAdded: true }];
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
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '人物')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `人物 ${index + 1}`],
                  ['是否需要', item.required === false ? '不需要' : '需要'],
                  ['参考方式', (fieldText(item.referenceMode) || (hasSelectedAssetReference ? 'asset' : 'prompt')) === 'asset' ? '参考素材' : '参考提示词'],
                  ['人物素材', hasSelectedAssetReference ? '已选择人物素材' : undefined],
                  ['人物描述提示词', characterDisplayPromptText(item)],
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '人物', { addLabel: '+ 添加人物', onAdd: addItem })}
            <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
              <AppForm.Item label="当前">
                <div className="remake-current-line">
                  <span>{fieldText(item.label) || `人物 ${index + 1}`}</span>
                  {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
                </div>
              </AppForm.Item>
              <AppForm.Item className="remake-radio-field" label="是否需要此人物">
                <Radio.Group
                  options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                  value={item.required === false ? 'no' : 'yes'}
                  onChange={(event) => setItem({ required: event.target.value !== 'no' })}
                />
              </AppForm.Item>
              {item.required === false ? null : (
                <>
                  <AppForm.Item className="remake-radio-field" label="人物设定参考">
                    <Radio.Group
                      options={[{ label: '参考素材', value: 'asset' }, { label: '参考提示词', value: 'prompt' }]}
                      value={mode}
                      onChange={(event) => setItem({ referenceMode: event.target.value, assetId: event.target.value === 'prompt' ? '' : item.assetId })}
                    />
                  </AppForm.Item>
                  {mode === 'asset' ? (
                    <AppForm.Item label="人物素材">
                      <SquareReferencePicker
                        asset={findSelectedAsset(props.assets, item.assetId)}
                        assets={props.assets}
                        emptyText="点击选择人物素材"
                        group={findSelectedGroup(props.groups, item.groupId)}
                        groups={props.groups}
                        onClear={fieldText(item.assetId) || fieldText(item.groupId) ? () => setItem({ assetId: '', groupId: '' }) : undefined}
                        onEnsureAssets={props.onEnsureAssets}
                        onSelect={(selection) => setItem({ assetId: selection.assetId || '', groupId: selection.groupId || '' })}
                        pickText="选择人物素材"
                        selectorKind="character"
                        selectorTitle="选择人物素材"
                      />
                    </AppForm.Item>
                  ) : null}
                  <AppForm.Item label="人物描述提示词">
                    <Input.TextArea
                      autoSize={{ minRows: 3 }}
                      value={cleanReferencePromptText(item.characterPrompt)}
                      onChange={(event) => setItem({ characterPrompt: event.target.value })}
                    />
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
