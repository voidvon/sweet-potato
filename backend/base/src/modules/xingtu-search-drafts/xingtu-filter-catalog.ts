import type { XingtuFilterFieldDef, XingtuFilterValueDef } from './xingtu-search-draft.types.js';

const FIELD_DEFS: XingtuFilterFieldDef[] = [
  {
    field: 'industry',
    label: '行业',
    category: 'base',
    valueType: 'single',
    supportedOps: ['eq'],
    aliases: ['行业', '类目'],
  },
  {
    field: 'region',
    label: '地区',
    category: 'base',
    valueType: 'single',
    supportedOps: ['eq'],
    aliases: ['地区', '城市', '地域'],
  },
  {
    field: 'creator_type',
    label: '达人类型',
    category: 'base',
    valueType: 'multi',
    supportedOps: ['in'],
    aliases: ['达人类型', '博主类型'],
  },
  {
    field: 'short_drama_topic',
    label: '短剧题材',
    category: 'content',
    valueType: 'multi',
    supportedOps: ['in'],
    aliases: ['短剧题材', '剧情题材', '短剧类型'],
  },
  {
    field: 'quote_21_60s',
    label: '21-60秒报价',
    category: 'price',
    valueType: 'range',
    supportedOps: ['between', 'gte', 'lte'],
    aliases: ['21-60秒报价', '报价', '刊例价'],
  },
];

const VALUE_DEFS: XingtuFilterValueDef[] = [
  {
    field: 'industry',
    value: 'beauty_personal_care',
    label: '美妆个护',
    aliases: ['美妆护肤', '护肤', '彩妆', '美妆个护'],
  },
  {
    field: 'industry',
    value: 'mother_baby',
    label: '母婴',
    aliases: ['母婴', '育儿', '宝宝'],
  },
  {
    field: 'industry',
    value: 'food_beverage',
    label: '食品饮料',
    aliases: ['食品饮料', '零食', '饮料', '美食'],
  },
  {
    field: 'region',
    value: 'shanghai',
    label: '上海',
    aliases: ['上海', '上海地区'],
  },
  {
    field: 'region',
    value: 'beijing',
    label: '北京',
    aliases: ['北京', '北京地区'],
  },
  {
    field: 'region',
    value: 'guangzhou',
    label: '广州',
    aliases: ['广州', '广州地区'],
  },
  {
    field: 'region',
    value: 'shenzhen',
    label: '深圳',
    aliases: ['深圳', '深圳地区'],
  },
  {
    field: 'creator_type',
    value: 'short_video',
    label: '短视频达人',
    aliases: ['短视频达人', '短视频博主'],
  },
  {
    field: 'creator_type',
    value: 'short_live',
    label: '短直达人',
    aliases: ['短直达人', '带货达人', '直播达人'],
  },
  {
    field: 'creator_type',
    value: 'short_drama_actor',
    label: '短剧演员',
    aliases: ['短剧演员', '短剧达人', '演员', '剧情演员'],
  },
  {
    field: 'short_drama_topic',
    value: 'workplace',
    label: '职场',
    aliases: ['职场', '职场成长', '职场干货', '办公室', '办公'],
  },
  {
    field: 'short_drama_topic',
    value: 'comedy',
    label: '搞笑',
    aliases: ['搞笑', '喜剧', '欢乐'],
  },
  {
    field: 'short_drama_topic',
    value: 'growth',
    label: '成长',
    aliases: ['成长', '逆袭'],
  },
  {
    field: 'short_drama_topic',
    value: 'romance',
    label: '爱情',
    aliases: ['爱情', '恋爱', '甜宠'],
  },
];

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function candidateTokens(def: XingtuFilterValueDef) {
  return [def.label, ...(def.aliases || [])].map(normalizeText);
}

export function listXingtuFilterFieldDefinitions() {
  return FIELD_DEFS;
}

export function listXingtuFilterValueDefinitions() {
  return VALUE_DEFS;
}

export function findXingtuCatalogValueByAlias(field: string, text: string) {
  const normalized = normalizeText(text);
  return VALUE_DEFS.find((item) => item.field === field && candidateTokens(item).some((token) => normalized.includes(token)));
}

export function findXingtuCatalogValueLabel(field: string, value: string) {
  return VALUE_DEFS.find((item) => item.field === field && item.value === value)?.label || value;
}

export function findXingtuFieldDefinition(field: string) {
  return FIELD_DEFS.find((item) => item.field === field);
}
