// 只复盘真实问答；不读取汤底内容，也不猜测玩家当时的想法。
const ENDED = new Set(['won', 'lost', 'gaveup']);
const ANSWERS = Object.freeze({ yes: '是', no: '否' });
const uniqueIds = (value) => [...new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id) : [])];
const questionKey = (q) => q.replace(/[\s，。,.?？!！、]/gu, '').toLowerCase();

export function buildReview(st) {
  if (!ENDED.has(st?.status) || !st.reveal) return null;
  const stats = { invalid: 0, unknown: 0, repeatedFact: 0 };
  const breakthroughs = [], exclusions = [], confirmedIds = new Set(), excludedQuestions = new Set();
  let firstBreak = null, no = 0;
  for (const entry of Array.isArray(st.log) ? st.log : []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.counted) no++;
    if (entry.verdict === 'invalid') stats.invalid++;
    if (entry.verdict === 'unknown') stats.unknown++;
    const label = ANSWERS[entry.verdict];
    if (!label || typeof entry.q !== 'string' || !entry.q.trim()) continue;
    const ids = uniqueIds(entry.newClues), fresh = ids.filter((id) => !confirmedIds.has(id));
    for (const id of fresh) confirmedIds.add(id);
    if (fresh.length) {
      firstBreak ??= { q: entry.q, no, ids: fresh, label };
      if (breakthroughs.length < 3) breakthroughs.push({ q: entry.q, no, count: fresh.length, label });
    }
    if (uniqueIds(entry.reClues).length && ids.length === 0) stats.repeatedFact++;
    if (entry.verdict === 'no') {
      const key = questionKey(entry.q);
      if (!excludedQuestions.has(key)) {
        excludedQuestions.add(key);
        if (exclusions.length < 3) exclusions.push({ q: entry.q, no, label });
      }
    }
  }
  const summary = confirmedIds.size
    ? `本局通过提问确认了 ${confirmedIds.size} 项关键事实${excludedQuestions.size ? `，留下 ${excludedQuestions.size} 条排除记录` : ''}。`
    : excludedQuestions.size ? `本局留下了 ${excludedQuestions.size} 条排除记录，尚未通过提问确认关键事实。`
      : '本局尚未通过提问确认关键事实。';
  return { firstBreak, breakthroughs, exclusions, stats, summary };
}

const FEATURED = ['rainy-elevator', 'second-cake', 'after-curtain'];
const SCENES = Object.freeze({
  'blind-meal': 'home', 'family-photo': 'home', 'imaginary-brother': 'home', 'second-cake': 'home',
  'discount-snack': 'shop', 'glass-of-water': 'bar', 'rainy-elevator': 'elevator',
  'lighthouse-night': 'coast', 'desert-match': 'desert', 'recording-alibi': 'recording',
  'after-curtain': 'theater', 'mirror-alibi': 'mirror',
});
const difficulty = (p) => Math.max(1, Math.min(3, Number(p?.difficulty) || 2));
const hasPlayed = (played, id) => played instanceof Set ? played.has(id) : Boolean(played && Object.hasOwn(played, id) && played[id]);

export function recommendNext(puzzles, st, played = {}) {
  const available = (Array.isArray(puzzles) ? puzzles : []).filter((p) => p && typeof p.id === 'string' && p.id !== st?.puzzle?.id && (!p.collection || p.collection === 'horror') && !hasPlayed(played, p.id));
  if (!available.length) return null;
  const current = difficulty(st?.puzzle), hints = Number(st?.stats?.hints) || 0;
  const used = Number(st?.stats?.used);
  const easing = ['gaveup', 'lost'].includes(st?.status) || hints >= 2;
  const steppingUp = !easing && st?.status === 'won' && hints === 0 && Number.isFinite(used) && used <= 16;
  const target = easing ? Math.max(1, current - 1) : steppingUp ? Math.min(3, current + 1) : current;
  const fromScene = SCENES[st?.puzzle?.id];
  const score = (p) => {
    const next = difficulty(p), featuredIndex = FEATURED.indexOf(p.id);
    return [
      easing && next > current ? 1 : steppingUp && next < current ? 1 : 0,
      Math.abs(next - target),
      fromScene && SCENES[p.id] === fromScene ? 1 : 0,
      featuredIndex < 0 ? 1 : 0,
      featuredIndex < 0 ? FEATURED.length : featuredIndex,
    ];
  };
  const ordered = available.map((puzzle) => ({ puzzle, score: score(puzzle) })).sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    return a.puzzle.id < b.puzzle.id ? -1 : a.puzzle.id > b.puzzle.id ? 1 : 0;
  });
  const puzzle = ordered[0].puzzle, next = difficulty(puzzle);
  let reason;
  if (easing && next < current) reason = '下一宗难度更低，换个故事继续推理。';
  else if (steppingUp && next > current) reason = '本局没有用提示、提问也较少，可以试一宗更高难度的故事。';
  else if (next === current) reason = '继续一宗同难度、尚未玩过的故事。';
  else reason = '未玩的卷宗里，这宗难度最接近当前案件。';
  if (FEATURED.includes(puzzle.id)) reason += ' 这宗也有随线索推进的现场演出。';
  return { puzzle, reason };
}
