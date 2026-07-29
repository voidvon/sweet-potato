import { asRecord, fieldText } from '../videoRemakeCardUtils';
import { ReadonlyCard } from './cardShell';
import { compactLines, type CardRendererProps } from './shared';

export function ExpertAnalysisCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const legacySections = ['audio', 'visual', 'pip']
    .map((key) => asRecord(data[key]))
    .filter((section) => Object.keys(section).length > 0);
  const sections = legacySections.length ? legacySections : [data];

  const readableLabels: Record<string, string> = {
    videoTitle: '视频标题',
    sceneDescription: '场景描述',
    characterImage: '人物形象',
    characterAction: '人物动作',
    expressionDetail: '表情细节',
    cameraMovement: '运镜方式',
    sceneChange: '景别变化',
    transition: '转场方式',
    cameraRhythm: '镜头节奏',
    soundEffect: '声音特效',
    subtitleStyle: '字幕样式',
    visualEffect: '画面特效',
    overallMood: '整体氛围',
    productInfo: '产品信息',
    appeared: '是否出现',
    summary: '总结',
    startSecond: '开始时间',
    endSecond: '结束时间',
    position: '位置',
    content: '内容',
    confidence: '置信度',
    label: '名称',
    description: '描述',
    start: '开始时间',
    end: '结束时间',
    startTime: '开始时间',
    endTime: '结束时间',
    duration: '时长',
    spokenCue: '口播',
    speckCue: '口播',
    speechCue: '口播',
    narrationCue: '口播',
    视频内容: '视频内容',
    场景描述: '场景描述',
    场景名称: '场景名称',
    人物描述: '人物描述',
    人物名称: '人物名称',
    产品描述: '产品描述',
    产品名称: '产品名称',
    产品信息: '产品信息',
    画中画信息: '画中画信息',
    开始秒: '开始秒',
    结束秒: '结束秒',
    口播线索: '口播线索',
    环境布置: '环境布置',
    空间层次: '空间层次',
    光线氛围: '光线氛围',
  };

  const humanKey = (key: string) => readableLabels[key] || key;

  const parseJsonLike = (value: string): unknown | null => {
    const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/```\s*$/u, '').trim();
    const candidates = [trimmed];
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(trimmed.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    for (const candidate of candidates) {
      const jsonText = candidate.trim();
      if (!jsonText.startsWith('{') && !jsonText.startsWith('[')) {
        continue;
      }
      try {
        return JSON.parse(jsonText);
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  const stringify = (value: unknown): string => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const parsed = parseJsonLike(trimmed);
      if (parsed !== null) {
        return stringify(parsed);
      }
      return trimmed;
    }
    if (Array.isArray(value)) {
      return value.length ? value.map((item, index) => {
        if (typeof item === 'string') {
          return `${index + 1}. ${item}`;
        }
        const record = asRecord(item);
        const productName = fieldText(record['产品类型']) || `项目 ${index + 1}`;
        const productFeature = fieldText(record['产品特征']);
        const displayMode = fieldText(record['展示方式']);
        if (productFeature || displayMode) {
          return `${index + 1}. ${productName}${productFeature ? `，${productFeature}` : ''}${displayMode ? `；${displayMode}` : ''}`;
        }
        const summary: string = Object.entries(record)
          .filter(([key]) => !['id', 'type', 'raw'].includes(key))
          .map(([key, entry]) => `${humanKey(key)}：${stringify(entry)}`)
          .filter(Boolean)
          .join('；');
        return `${index + 1}. ${summary || String(item)}`;
      }).join('\n') : '';
    }
    if (value && typeof value === 'object') {
      return Object.entries(asRecord(value))
        .filter(([key]) => !['id', 'type', 'raw'].includes(key))
        .map(([key, item]) => `${humanKey(key)}：${stringify(item)}`)
        .filter((line) => !line.endsWith('：'))
        .join('；');
    }
    return value === undefined || value === null ? '' : String(value);
  };

  const visualSectionTitleMap: Record<string, string> = {
    task1: '基础识别',
    task2: '画面内容',
    task3: '镜头语言',
    task4: '视听元素',
    task5: '产品信息',
  };

  const visualFieldLabels: Record<string, string> = {
    视频标题: '视频标题',
    场景描述: '场景描述',
    人物形象: '人物形象',
    人物动作: '人物动作',
    表情细节: '表情细节',
    运镜方式: '运镜方式',
    景别变化: '景别变化',
    转场方式: '转场方式',
    镜头节奏: '镜头节奏',
    声音特效: '声音特效',
    字幕样式: '字幕样式',
    画面特效: '画面特效',
    整体氛围: '整体氛围',
  };

  const structuredArrayPrefix = (key: string) => {
    if (key.includes('场景')) {
      return '场景';
    }
    if (key.includes('人物')) {
      return '人物';
    }
    if (key.includes('产品')) {
      return '产品';
    }
    if (key.includes('画中画')) {
      return '画中画';
    }
    if (key.includes('口播')) {
      return '口播';
    }
    return humanKey(key).replace(/(描述|信息|列表)$/u, '') || '项目';
  };

  const isEntityRecordKey = (key: string) => /^(?:场景|人物|产品|画中画|口播)\s*[0-9一二三四五六七八九十]+/u.test(key.trim());

  const structuredRowsFromAny = (value: unknown, sourceKey = '解析内容'): Array<{ label: string; text: string }> => {
    if (typeof value === 'string') {
      const parsed = parseJsonLike(value);
      if (parsed !== null) {
        return structuredRowsFromAny(parsed, sourceKey);
      }
      return value.trim() ? [{ label: humanKey(sourceKey), text: value.trim() }] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => {
        if (typeof item === 'string') {
          return item.trim() ? [{ label: `${structuredArrayPrefix(sourceKey)} ${index + 1}`, text: item.trim() }] : [];
        }
        const record = asRecord(item);
        const wrappedEntry = Object.entries(record).length === 1 ? Object.entries(record)[0] : undefined;
        if (wrappedEntry && asRecord(wrappedEntry[1])) {
          return structuredRowsFromAny(wrappedEntry[1], wrappedEntry[0]);
        }
        const text = stringify(item);
        return text.trim() ? [{ label: `${structuredArrayPrefix(sourceKey)} ${index + 1}`, text }] : [];
      });
    }
    if (value && typeof value === 'object') {
      const record = asRecord(value);
      const entries = Object.entries(record);
      const entityRows = entries.flatMap(([key, entry]) => {
        if (isEntityRecordKey(key) || Array.isArray(entry)) {
          return structuredRowsFromAny(entry, key);
        }
        return [];
      });
      if (entityRows.length) {
        const directRows = entries.flatMap(([key, entry]) => {
          if (isEntityRecordKey(key) || Array.isArray(entry)) {
            return [];
          }
          const text = stringify(entry);
          return text.trim() ? [{ label: visualFieldLabels[key] || humanKey(key), text }] : [];
        });
        return [...directRows, ...entityRows];
      }
      const label = isEntityRecordKey(sourceKey) ? sourceKey : (visualFieldLabels[sourceKey] || humanKey(sourceKey));
      const skippedKeys = new Set(['id', 'type', 'raw', 'label', 'name']);
      const text = compactLines(entries
        .filter(([key]) => !skippedKeys.has(key))
        .map(([key, entry]) => [humanKey(key), stringify(entry)] as [string, string | undefined]));
      return text.trim() ? [{ label, text }] : [];
    }
    const text = stringify(value);
    return text.trim() ? [{ label: humanKey(sourceKey), text }] : [];
  };

  const visualRowsFromTaskJson = (content: string) => {
    const trimmed = content.trim();
    const parsedJson = parseJsonLike(trimmed);
    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      return [{ label: '解析内容', text: trimmed }];
    }
    return Object.entries(parsedJson).map(([taskKey, taskValue]) => {
      const task = asRecord(taskValue);
      const fields = Object.entries(task).flatMap(([fieldKey, fieldValue]) => {
        if (fieldKey === 'content') {
          return structuredRowsFromAny(fieldValue, fieldKey);
        }
        return structuredRowsFromAny(fieldValue, fieldKey);
      });
      const fallbackFields = fields.length ? fields : structuredRowsFromAny(taskValue, taskKey);
      return { label: visualSectionTitleMap[taskKey] || humanKey(taskKey) || '解析内容', fields: fallbackFields };
    }).filter((entry) => entry.fields.length);
  };

  const pipItemsText = (items: unknown[]) => {
    return items.map((item, index) => {
      const record = asRecord(item);
      const start = fieldText(record.startSecond);
      const end = fieldText(record.endSecond);
      return compactLines([
        [`画中画 ${index + 1}`, fieldText(record.label)],
        ['时间', start || end ? `${start || '?'}s - ${end || '?'}s` : undefined],
        ['位置', fieldText(record.position)],
        ['内容', stringify(record.content || record.description || record.summary)],
        ['置信度', fieldText(record.confidence)],
      ]);
    }).filter(Boolean).join('\n\n');
  };

  const pipRowsFromLooseText = (value: string) => {
    const text = value.trim();
    if (!text) {
      return [];
    }
    const itemBlocks = Array.from(text.matchAll(/\{[\s\S]*?["']?content["']?\s*:\s*["'][\s\S]*?["']\s*,?\s*["']?confidence["']?\s*:\s*[^}\n]+[\s\S]*?\}/giu))
      .map((match) => match[0]);
    const rows = itemBlocks.map((block, index) => {
      const pickString = (key: string) => {
        const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']*)["']`, 'iu');
        return block.match(pattern)?.[1]?.trim() || '';
      };
      const pickNumber = (key: string) => {
        const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*([0-9.]+)`, 'iu');
        return block.match(pattern)?.[1]?.trim() || '';
      };
      const start = pickNumber('startSecond');
      const end = pickNumber('endSecond');
      const rowText = compactLines([
        ['时间', start || end ? `${start || '?'}s - ${end || '?'}s` : undefined],
        ['位置', pickString('position')],
        ['内容', pickString('content')],
        ['置信度', pickNumber('confidence')],
      ]);
      return rowText ? { label: `画中画 ${index + 1}`, text: rowText } : null;
    }).filter((row): row is { label: string; text: string } => Boolean(row));
    return rows;
  };

  const rowsForSection = (section: Record<string, unknown>) => {
    const expertKey = fieldText(section.expertKey);
    const roleName = fieldText(section.roleName);
    if (expertKey === 'audio' || roleName.includes('音频')) {
      return [{ label: '口播内容', text: fieldText(section.spokenContent) || fieldText(section.content) || fieldText(section.summary) }];
    }
    if (expertKey === 'visual' || roleName.includes('视频')) {
      return visualRowsFromTaskJson(fieldText(section.content) || fieldText(section.summary));
    }
    const pictureInPicture = asRecord(section.pictureInPicture);
    const items = Array.isArray(section.items) ? section.items : Array.isArray(pictureInPicture.items) ? pictureInPicture.items : [];
    const appeared = Boolean(section.appeared ?? pictureInPicture.appeared);
    if (expertKey === 'pip' || roleName.includes('画中画')) {
      const looseRows = pipRowsFromLooseText(fieldText(section.content) || fieldText(section.summary));
      if (!items.length && looseRows.length) {
        return looseRows;
      }
      if (!appeared || items.length === 0) {
        return [{ label: '画中画信息', text: fieldText(section.summary) || fieldText(pictureInPicture.summary) || '无画中画' }];
      }
      return [{ label: '画中画信息', text: pipItemsText(items) }];
    }
    return [{ label: '解析内容', text: fieldText(section.content) || fieldText(section.summary) }];
  };

  const hasFieldList = (entry: ReturnType<typeof rowsForSection>[number]): entry is { label: string; fields: Array<{ label: string; text: string }> } => (
    'fields' in entry && Array.isArray(entry.fields)
  );

  return (
    <ReadonlyCard>
      <div className="remake-expert-details">
        {sections.map((section, index) => {
          const roleName = fieldText(section.roleName) || `专家 ${index + 1}`;
          const entries = rowsForSection(section).filter((entry) => {
            if (hasFieldList(entry)) {
              return entry.fields.length;
            }
            return fieldText(entry.text).trim();
          });
          return (
            <section className="remake-expert-detail" key={`${roleName}-${index}`}>
              {entries.length ? entries.map((entry) => (
                <div className="remake-expert-row" key={entry.label}>
                  <span>{entry.label}</span>
                  {hasFieldList(entry) ? (
                    <div className="remake-expert-field-list">
                      {entry.fields.map((field, fieldIndex) => (
                        <p key={`${entry.label}-${field.label}-${fieldIndex}`}>
                          <b>{field.label}：</b>{field.text}
                        </p>
                      ))}
                    </div>
                  ) : <p>{fieldText(entry.text)}</p>}
                </div>
              )) : <p>等待专家分析结果同步。</p>}
            </section>
          );
        })}
      </div>
    </ReadonlyCard>
  );
}
