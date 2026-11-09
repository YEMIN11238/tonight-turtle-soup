// 开场只拆分公开汤面；不读取汤底、不生成新故事、不改变游戏状态。
export function openingParts(surface) {
  const source = String(surface ?? '').trim();
  if (!source) return [];
  const sentences = source.match(/[^。！？!?]+[。！？!?]*/gu) || [source];
  // 一句话一个阅读节拍，逗号不再切页；短句合并，避免短汤面被拉成八屏。
  const parts = [];
  for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    if (parts.length && Array.from(parts.at(-1) + sentence).length <= 54) parts[parts.length - 1] += sentence;
    else parts.push(sentence);
  }
  return parts;
}

export function openingDelay(text) {
  return Math.min(9000, Math.max(2800, Array.from(text).length * 180));
}

// 揭晓只在对局结束后使用服务端返回的完整汤底，保持原文与顺序。
export function revealParts(truth) {
  const source = String(truth ?? '').trim();
  const sentences = source.match(/[^。！？!?]+[。！？!?]*/gu) || (source ? [source] : []);
  const parts = []; let paragraph = '';
  for (const sentence of sentences) {
    if (paragraph && Array.from(paragraph + sentence).length > 56) { parts.push(paragraph); paragraph = sentence; }
    else paragraph += sentence;
  }
  if (paragraph) parts.push(paragraph);
  return parts;
}
