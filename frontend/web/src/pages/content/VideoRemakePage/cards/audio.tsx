import { Button, Input, Select, Tabs } from 'antd';
import { useEffect, useState } from 'react';
import { AppForm } from '../../../../components/AppForm';
import { asItems, asRecord, fieldBool, fieldText, updateAt } from '../videoRemakeCardUtils';
import { EditableCard, renderItemTabs } from './cardShell';
import { SquareReferencePicker, SummaryBlock, compactLines, findSelectedAsset, findSelectedGroup, resolveAudioCharacterLabel, type CardRendererProps } from './shared';

export function AudioCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('voice');
  useEffect(() => {
    setActiveIndex(0);
    setActiveTab('voice');
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && (JSON.stringify(props.card.data).includes('groupId') || JSON.stringify(props.card.data).includes('assetId'))) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ label: '人物 1 声音', voice: '原声' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const currentCharacterLabel = resolveAudioCharacterLabel(item, index);
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [
            ...items,
            {
              label: `人物 ${items.length + 1} 声音`,
              characterLabel: `人物 ${items.length + 1}`,
              characterIndex: items.length,
              voice: '原声',
              voiceStyle: '',
              manuallyAdded: true,
            },
          ];
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
              <Tabs
                activeKey={activeTab}
                items={[
                  { key: 'voice', label: '人声' },
                  { key: 'audio', label: '音频' },
                ]}
                onChange={setActiveTab}
              />
              {activeTab === 'voice' ? (
                <>
                  {renderItemTabs(items, activeIndex, setActiveIndex, '人物')}
                  <SummaryBlock
                    lines={compactLines([
                      ['当前', currentCharacterLabel],
                      ['声音策略', fieldText(item.voice)],
                      ['声音库', fieldText(item.groupId) || fieldText(item.assetId) ? '已选择声音库' : undefined],
                      ['声音描述', fieldText(item.voiceStyle)],
                    ])}
                  />
                </>
              ) : (
                <SummaryBlock
                  lines={compactLines([
                    ['BGM', fieldText(data.bgm)],
                    ['音效', fieldText(data.soundEffects)],
                  ])}
                  emptyText="暂无音频设定。"
                />
              )}
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            <Tabs
              activeKey={activeTab}
              items={[
                { key: 'voice', label: '人声' },
                { key: 'audio', label: '音频' },
              ]}
              onChange={setActiveTab}
            />
            {activeTab === 'voice' ? (
              <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
                {renderItemTabs(items, activeIndex, setActiveIndex, '人物', { addLabel: '+ 添加人声', onAdd: addItem })}
                <AppForm.Item label="当前">
                  <div className="remake-current-line">
                    <span>{currentCharacterLabel}</span>
                    {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
                  </div>
                </AppForm.Item>
                <AppForm.Item label="人声标签">
                  <Input
                    value={fieldText(item.characterLabel) || fieldText(item.label)}
                    onChange={(event) => setItem({ characterLabel: event.target.value, label: `${event.target.value || `人物 ${index + 1}`} 声音` })}
                  />
                </AppForm.Item>
                <AppForm.Item label="声音策略">
                  <Select
                    options={['原声', '替换声', '不生成'].map((value) => ({ label: value, value }))}
                    value={fieldText(item.voice) || '原声'}
                    onChange={(value) => setItem({ voice: value })}
                  />
                </AppForm.Item>
                {fieldText(item.voice) === '替换声' ? (
                  <AppForm.Item label="声音库">
                    <SquareReferencePicker
                      asset={findSelectedAsset(props.assets, item.assetId)}
                      assets={props.assets}
                      emptyText="点击选择声音库"
                      group={findSelectedGroup(props.groups, item.groupId)}
                      groups={props.groups}
                      onClear={fieldText(item.groupId) || fieldText(item.assetId) ? () => setItem({ groupId: '', assetId: '' }) : undefined}
                      onEnsureAssets={props.onEnsureAssets}
                      onSelect={(selection) => setItem({ groupId: selection.groupId || '', assetId: selection.assetId || '' })}
                      pickText="选择声音库"
                      preferAudioPreview
                      selectorKind="voice_group"
                      selectorTitle="选择声音库"
                    />
                  </AppForm.Item>
                ) : null}
                <AppForm.Item label="声音描述">
                  <Input.TextArea autoSize={{ minRows: 2 }} value={fieldText(item.voiceStyle)} onChange={(event) => setItem({ voiceStyle: event.target.value })} />
                </AppForm.Item>
              </AppForm>
            ) : (
              <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
                <AppForm.Item label="BGM">
                  <Input value={fieldText(data.bgm)} onChange={(event) => setDraft({ ...data, bgm: event.target.value })} />
                </AppForm.Item>
                <AppForm.Item label="音效">
                  <Input value={fieldText(data.soundEffects)} onChange={(event) => setDraft({ ...data, soundEffects: event.target.value })} />
                </AppForm.Item>
              </AppForm>
            )}
          </div>
        );
      }}
    </EditableCard>
  );
}
