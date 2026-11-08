// 案件 ID → 美术素材的显式映射（按《未明-美术交付包》asset-manifest.json）。
// 不依赖数组下标；新增案件时在这里登记。图中物件只用于氛围，不构成剧情事实。
export const CASE_ART = {
  'blind-meal': {
    displayTitle: '晚餐之后',
    no: '001',
    art: 'blind-dinner',
    tagline: '一顿寻常的晚饭，一次突然的报警。',
    alt: '雨夜餐桌上的一碗饭',
    pos: '50% 62%', // 保留右下碗、筷子与窗
    endPos: '67% 50%',
  },
  'discount-snack': {
    no: '002',
    art: 'discount-snacks',
    tagline: '一笔划算的买卖，一则第二天的新闻。',
    alt: '小卖部柜台上的零食与报纸',
    pos: '62% 50%', // 保留右侧零食袋
    endPos: '70% 50%',
  },
  'family-photo': {
    no: '003',
    art: 'family-photo',
    tagline: '临出门前的一瞥，一张熟悉的照片。',
    alt: '老屋里一张看不清细节的全家福',
    pos: '64% 50%', // 保留右侧相框
    endPos: '72% 50%',
  },
  'perfect-crime': {
    no: '004',
    art: 'perfect-crime',
    tagline: '一把剪刀，一个没有血迹的现场。',
    alt: '信封、信纸和合拢的剪刀',
    pos: '62% 58%', // 保留右下剪刀和信封
    endPos: '70% 55%',
  },
  'imaginary-brother': {
    displayTitle: '开门以后',
    no: '005',
    art: 'missing-brother',
    tagline: '一扇推开的门，一个不见了的人。',
    alt: '半开的门和安静的卧室',
    pos: '62% 50%', // 保留门与右侧空床
    endPos: '68% 50%',
  },
};

export const BG = 'assets/archive-room.webp';

export function artOf(id) {
  return CASE_ART[id] || { no: '000', art: null, tagline: '', alt: '', pos: '50% 50%', endPos: '50% 50%' };
}
export const imgSrc = (id, small = false) => {
  const a = artOf(id).art;
  return a ? `assets/${a}${small ? '-sm' : ''}.webp` : '';
};
