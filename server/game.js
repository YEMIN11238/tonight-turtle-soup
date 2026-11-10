// 纯游戏逻辑：不依赖网络，便于单测。
import { randomUUID } from 'node:crypto';

export const MAX_Q = 40;
export const MAX_HINTS = 3;
export const MAX_SUBMITS = 3;
export const PASS_RATIO = 70;

export const VERDICTS = ['yes', 'no', 'irrelevant', 'unknown', 'invalid'];
export const VERDICT_LABEL = { yes: '是', no: '否', irrelevant: '无关', unknown: '无法判断', invalid: '无效提问' };

const DEFAULT_REASON = {
  unknown: '故事里没有交代',
  invalid: '请换成能用“是/否”回答的单个问题',
};

export function newSession(puzzle) {
  return {
    id: randomUUID(),
    puzzleId: puzzle.id,
    asked: [], // {q, verdict, reason, counted, by}
    unlocked: [], // fact ids，按解锁顺序
    unlockedBy: {}, // factId -> 问题文本
    hintsUsed: 0,
    submits: 0,
    status: 'playing', // playing | won | lost | gaveup
    llmCalls: 0,
    createdAt: Date.now(),
    lastSubmitGaps: null,
  };
}

export const countedQuestions = (s) => s.asked.filter((a) => a.counted).length;
export const remaining = (s) => MAX_Q - countedQuestions(s);

export function progress(s, puzzle) {
  return puzzle.facts.filter((f) => s.unlocked.includes(f.id)).reduce((t, f) => t + f.weight, 0);
}

const norm = (q) => q.replace(/[\s，。,.?？!！、]/g, '').toLowerCase();

export function findDuplicate(s, q) {
  const n = norm(q);
  // “未交代”也缓存，避免同一句未知问题反复调用模型；无效问题允许修正后再问。
  return s.asked.find((a) => a.verdict !== 'invalid' && norm(a.q) === n);
}

// 泄底检查：理由里不得出现禁词，或与汤底有 5 字以上连续重合。
export function leaks(reason, puzzle) {
  if (!reason) return false;
  if ((puzzle.leak_terms || []).some((t) => reason.includes(t))) return true;
  const truth = puzzle.truth.replace(/\s/g, '');
  const r = reason.replace(/\s/g, '');
  for (let i = 0; i + 5 <= r.length; i++) if (truth.includes(r.slice(i, i + 5))) return true;
  return false;
}

// no 只能确认题库明确标注的负向事实，防止“不是十八楼”被补成“是十二楼”。
export function sanitizeJudge(raw, puzzle) {
  let verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : 'unknown';
  const validIds = new Set(puzzle.facts.filter((f) => verdict !== 'no' || f.confirm_on_no === true).map((f) => f.id));
  const legacy = verdict === 'yes' && Array.isArray(raw?.matched_fact_ids) ? raw.matched_fact_ids : [];
  const confirmed = ['yes', 'no'].includes(verdict) && Array.isArray(raw?.confirmed_fact_ids) ? raw.confirmed_fact_ids : [];
  const matched = [...new Set([...legacy, ...confirmed].filter((id) => validIds.has(id)))];
  let reason = '';
  if (verdict === 'unknown' || verdict === 'invalid') {
    // 只放行与游戏规则有关的固定理由，不能借自由文本补充故事信息。
    const safeInvalidReasons = ['请一次只问一件事', '请换成能用“是/否”回答的单个问题', '不能直接索要汤底'];
    reason = verdict === 'invalid' && safeInvalidReasons.includes(raw?.reason) ? raw.reason : DEFAULT_REASON[verdict];
  }
  return { verdict, matched, reason };
}

export function applyAsk(s, puzzle, q, judged, by = '你') {
  const counted = !['invalid', 'unknown'].includes(judged.verdict);
  const entry = { q, verdict: judged.verdict, reason: judged.reason, counted, by, newClues: [], reClues: [], newExclusion: judged.verdict === 'no' && !s.asked.some((a) => a.verdict === 'no' && norm(a.q) === norm(q)) };
  const no = s.asked.filter((a) => a.counted).length + (counted ? 1 : 0);
  for (const id of ['yes', 'no'].includes(judged.verdict) ? (judged.matched || []) : []) {
    const fact = puzzle.facts.find((f) => f.id === id);
    // 关键演出事实还需问题明确提及对应概念，防止“有人”误触发“被囚禁”。
    if (!fact || judged.verdict === 'no' && fact.confirm_on_no !== true || !matchesQuestionTerms(fact, q)) continue;
    if (!s.unlocked.includes(id)) {
      s.unlocked.push(id);
      s.unlockedBy[id] = q;
      s.unlockedNo ??= {};
      s.unlockedNo[id] = no;
      entry.newClues.push(id);
    } else entry.reClues.push(id);
  }
  s.asked.push(entry);
  return entry;
}

function matchesQuestionTerms(fact, question) {
  return !fact.question_terms || fact.question_terms.every((group) => group.some((term) => question.includes(term)));
}

function sceneStage(s, puzzle) {
  if (!['second-cake', 'rainy-elevator', 'after-curtain'].includes(puzzle.id)) return undefined;
  if (s.status !== 'playing') return 'revealed';
  const confirmed = (id) => {
    const fact = puzzle.facts.find((f) => f.id === id), source = s.unlockedBy?.[id] || '';
    // 同时校验历史来源，旧版本误收录的宽泛问题也不能提前触发新演出。
    return Boolean(fact && s.unlocked.includes(id) && (source === '（推理中说出）' || matchesQuestionTerms(fact, source)));
  };
  if (puzzle.id === 'second-cake') {
    if (confirmed('f3')) return 'locked';
    return s.unlocked.includes('f6') ? 'presence' : 'quiet';
  }
  if (puzzle.id === 'rainy-elevator') {
    if (confirmed('f4')) return 'followed';
    return confirmed('f3') ? 'watched' : 'quiet';
  }
  if (confirmed('f3')) return 'below';
  return confirmed('f1') ? 'unpowered' : 'quiet';
}

function publicExclusions(s) {
  const seen = new Set();
  let no = 0;
  return s.asked.flatMap((a) => {
    if (a.counted) no++;
    const key = norm(a.q);
    if (a.verdict !== 'no' || seen.has(key)) return [];
    seen.add(key);
    // 保留原始问句和“否”，不把带否定词的问题改写成可能相反的断言。
    return [{ id: `excluded-${seen.size}`, q: a.q, card: a.q, label: '否', no, by: a.by || '你' }];
  });
}

// 提交判分：core 全部“完整覆盖”，且加权（部分覆盖算一半）不低于阈值。
export function scoreSubmission(puzzle, covered, partial = [], unlocked = []) {
  const cov = new Set(covered);
  for (const f of puzzle.facts) if (!f.core && unlocked.includes(f.id)) cov.add(f.id);
  const par = new Set(partial.filter((id) => !cov.has(id)));
  const score = puzzle.facts.reduce((t, f) => t + (cov.has(f.id) ? f.weight : par.has(f.id) ? f.weight / 2 : 0), 0);
  const coreOk = puzzle.facts.filter((f) => f.core).every((f) => cov.has(f.id));
  const missing = puzzle.facts.filter((f) => !cov.has(f.id));
  return { score: Math.round(score), coreOk, passed: coreOk && score >= PASS_RATIO, missing };
}

// 没通过时只告诉玩家缺哪个“维度”，不泄露具体内容。
export function gapDims(missing) {
  return [...new Set(missing.map((f) => f.dim))];
}

export function publicState(s, puzzle) {
  const dims = {};
  for (const f of puzzle.facts) {
    dims[f.dim] ??= { name: f.dim, total: 0, got: 0 };
    dims[f.dim].total++;
    if (s.unlocked.includes(f.id)) dims[f.dim].got++;
  }
  const over = s.status !== 'playing';
  return {
    sid: s.id,
    puzzle: { id: puzzle.id, title: puzzle.title, surface: puzzle.surface, difficulty: puzzle.difficulty, tag: puzzle.tag },
    status: s.status,
    maxQ: MAX_Q,
    remaining: remaining(s),
    hintsLeft: MAX_HINTS - s.hintsUsed,
    submitsLeft: MAX_SUBMITS - s.submits,
    progress: progress(s, puzzle),
    dims: Object.values(dims),
    clues: s.unlocked.filter((id) => puzzle.facts.some((f) => f.id === id)).map((id) => {
      const f = puzzle.facts.find((x) => x.id === id);
      const q = s.unlockedBy[id] || '', submission = q === '（推理中说出）';
      const entry = s.asked.find((a) => a.q === q && ['yes', 'no'].includes(a.verdict) && (a.newClues?.includes(id) || a.reClues?.includes(id)))
        || s.asked.find((a) => a.q === q && ['yes', 'no'].includes(a.verdict));
      // 即使模型过宽匹配了某项事实，公开卡片也不扩写玩家尚未问到的条件。
      return { id, card: submission ? '这项事实已在你的推理中确认。' : q, label: submission ? '已确认' : VERDICT_LABEL[entry?.verdict] || '是', source: submission ? 'submission' : 'question', weight: f.weight, dim: f.dim, by: entry?.by || '你', q, no: s.unlockedNo?.[id] ?? null };
    }),
    exclusions: publicExclusions(s),
    ...(['second-cake', 'rainy-elevator', 'after-curtain'].includes(puzzle.id) ? { sceneStage: sceneStage(s, puzzle) } : {}),
    nudges: puzzle.nudges,
    hints: puzzle.hints.slice(0, s.hintsUsed),
    log: s.asked.map((a) => ({ q: a.q, verdict: a.verdict, label: VERDICT_LABEL[a.verdict], reason: a.reason, counted: a.counted, newClues: a.newClues, reClues: a.reClues || [], newExclusion: Boolean(a.newExclusion) })),
    gaps: s.lastSubmitGaps,
    reveal: over
      ? {
          truth: puzzle.truth,
   found: puzzle.facts.filter((f) => s.unlocked.includes(f.id)).map((f) => f.text),
   missed: puzzle.facts.filter((f) => !s.unlocked.includes(f.id)).map((f) => f.text),
        }
      : undefined,
    stats: over ? { used: countedQuestions(s), hints: s.hintsUsed, submits: s.submits, score: s.lastScore ?? null } : undefined,
  };
}
