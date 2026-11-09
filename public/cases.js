// 案件 ID → 独立场景图、缩略图与取景位置的显式映射。
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
  'glass-of-water': {
    no: '006', art: 'water-glass',
    tagline: '一句轻松的招呼，一张让人逃走的杯垫。',
    alt: '深夜空酒吧的木质吧台上放着一杯水',
    pos: '66% 50%', endPos: '78% 50%',
  },
  'rainy-elevator': {
    no: '007', art: 'rainy-elevator',
    tagline: '他问你住几楼，却比你先知道答案。',
    alt: '雨夜老楼中紧闭的铜色电梯门',
    pos: '64% 50%', endPos: '73% 50%',
  },
  'lighthouse-night': {
    no: '008', art: 'lighthouse-night',
    tagline: '灯熄灭以后，海上发生了什么？',
    alt: '黑夜海岸上的一座孤独灯塔',
    pos: '65% 50%', endPos: '73% 50%',
  },
  'desert-match': {
    no: '009', art: 'desert-match',
    tagline: '无边沙海里，为什么留着半根火柴？',
    alt: '风沙中的旧外套与一根短火柴',
    pos: '63% 58%', endPos: '72% 58%',
  },
  'recording-alibi': {
    no: '010', art: 'recording-alibi',
    tagline: '录音已经结束，有人却留下了另一个动作。',
    alt: '昏暗房间桌上的旧式磁带录音机',
    pos: '66% 55%', endPos: '76% 55%',
  },
  'second-cake': {
    no: '011', art: 'second-cake',
    tagline: '每年都有两个蛋糕，另一个送给谁？',
    alt: '黑暗老宅里两个相同的生日蛋糕',
    pos: '65% 50%', endPos: '72% 50%',
  },
  'after-curtain': {
    no: '012', art: 'after-curtain',
    tagline: '电源已经切断，掌声为什么还没有停？',
    alt: '空无一人的旧剧院与暗处的木质舞台',
    pos: '65% 50%', endPos: '73% 50%',
  },
  'mirror-alibi': {
    no: '013', art: 'mirror-alibi',
    tagline: '镜子里的时间，真的和他说的一样吗？',
    alt: '昏暗房间的旧镜子与模糊的挂钟倒影',
    pos: '65% 50%', endPos: '76% 50%',
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
