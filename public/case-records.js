// 本机战绩只记录公开统计，不保存汤底或玩家的推理内容。
export const RECORD_KEY = 'ts_case_records_v1';
export function readRecords(storage) {
  try {
    const value = JSON.parse(storage.getItem(RECORD_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function saveRecord(storage, st) {
  if (!st?.stats || st.status === 'playing') return null;
  const records = readRecords(storage), previous = records[st.puzzle.id] || {};
  if (previous.lastSid === st.sid) return previous;
  const attempt = { used: st.stats.used, hints: st.stats.hints, score: st.stats.score, status: st.status };
  const better = st.status === 'won' && (!previous.best || attempt.used < previous.best.used || (attempt.used === previous.best.used && attempt.hints < previous.best.hints));
  const record = { ...previous, lastSid: st.sid, last: attempt, best: better ? attempt : previous.best, completed: (previous.completed || 0) + 1 };
  records[st.puzzle.id] = record;
  try { storage.setItem(RECORD_KEY, JSON.stringify(records)); } catch {}
  return record;
}
export function challengeText(st) {
  if (st?.status === 'won') return `我用 ${st.stats.used} 问解开了《${st.puzzle.title}》${st.stats.hints === 0 ? '，全程没有用提示' : `，用了 ${st.stats.hints} 次提示`}。你会从哪一个问题开始？`;
  return `《${st?.puzzle?.title || '今晚喝什么汤'}》的真相，你敢猜吗？`;
}

// 分享卡只用案件名、公开封面和本局成绩，绝不绘入汤底、线索或问句。
export async function makeShareCard(st, src, url) {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 1280;
  const c = canvas.getContext('2d');
  c.fillStyle = '#1d130d'; c.fillRect(0, 0, 960, 1280);
  const img = new Image(); img.src = src;
  try { await img.decode(); const scale = Math.max(960 / img.width, 700 / img.height); c.drawImage(img, (960 - img.width * scale) / 2, 0, img.width * scale, img.height * scale); } catch {}
  const shade = c.createLinearGradient(0, 250, 0, 760); shade.addColorStop(0, '#1d130d00'); shade.addColorStop(1, '#1d130d'); c.fillStyle = shade; c.fillRect(0, 250, 960, 530);
  c.strokeStyle = '#b7955b'; c.lineWidth = 2; c.strokeRect(38, 38, 884, 1204);
  c.textAlign = 'center'; c.fillStyle = '#d8bf8c'; c.font = '25px serif'; c.fillText('今 晚 喝 什 么 汤', 480, 97);
  c.fillStyle = '#f2e6cc'; c.font = 'bold 54px serif'; c.fillText(st.puzzle.title, 480, 660, 800);
  c.font = '26px sans-serif'; c.fillStyle = '#c9b79a'; c.fillText(st.status === 'won' ? '案 件 已 破 · 真 相 保 密' : '卷 宗 已 翻 开 · 真 相 保 密', 480, 724);
  c.fillStyle = '#ead3a5'; c.font = 'bold 110px serif'; c.fillText(String(st.stats.used), 480, 870);
  c.fillStyle = '#c9b79a'; c.font = '28px sans-serif'; c.fillText('本局提问', 480, 918);
  c.font = '25px sans-serif'; c.fillText(`提示 ${st.stats.hints} 次    ·    ${st.status === 'won' ? '成功结案' : st.status === 'gaveup' ? '主动揭晓' : '尚未还原'}`, 480, 983);
  c.fillStyle = '#f0dec0'; c.font = '32px serif'; c.fillText('你会从哪一个问题开始？', 480, 1080);
  c.fillStyle = '#b6a185'; c.font = '20px sans-serif'; c.fillText(new URL(url).host, 480, 1142);
  c.font = '18px sans-serif'; c.fillText('和邀请链接一起分享 · 不剧透', 480, 1181);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('战绩卡暂时无法生成，请重试')), 'image/png'));
}
