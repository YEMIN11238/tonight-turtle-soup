// 开场只拆分公开汤面；不读取汤底、不生成新故事、不改变游戏状态。
export function openingParts(surface) {
  const source = String(surface ?? '').trim();
  if (!source) return [];
  const sentences = source.match(/[^。！？!?]+[。！？!?]*/gu) || [source];
  return sentences.flatMap((sentence) => sentence.length > 24
    ? sentence.match(/[^，,；;]+[，,；;]*/gu) || [sentence]
    : [sentence]).map((part) => part.trim()).filter(Boolean);
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
