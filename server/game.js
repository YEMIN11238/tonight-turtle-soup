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
  return s.asked.find((a) => a.counted && norm(a.q) === n);
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

// 把模型输出收敛成受信任的结构。模型只给 verdict / matched / reason，其余由服务端决定。
export function sanitizeJudge(raw, puzzle) {
  let verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : 'unknown';
  const validIds = new Set(puzzle.facts.map((f) => f.id));
  const matched = verdict === 'yes' && Array.isArray(raw?.matched_fact_ids) ? raw.matched_fact_ids.filter((id) => validIds.has(id)) : [];
  let reason = '';
  if (verdict === 'unknown' || verdict === 'invalid') {
    reason = String(raw?.reason ?? '').trim().slice(0, 30);
    if (!reason || leaks(reason, puzzle)) reason = DEFAULT_REASON[verdict];
  }
  return { verdict, matched, reason };
}

export function applyAsk(s, puzzle, q, judged, by = '你') {
  const counted = judged.verdict !== 'invalid';
  const entry = { q, verdict: judged.verdict, reason: judged.reason, counted, by, newClues: [], reClues: [] };
  const no = s.asked.filter((a) => a.counted).length + (counted ? 1 : 0);
  for (const id of judged.matched) {
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
    clues: s.unlocked.map((id) => {
      const f = puzzle.facts.find((x) => x.id === id);
      return { id, card: f.card, weight: f.weight, dim: f.dim, by: '你', q: s.unlockedBy[id], no: s.unlockedNo?.[id] ?? null };
    }),
    nudges: puzzle.nudges,
    hints: puzzle.hints.slice(0, s.hintsUsed),
    log: s.asked.map((a) => ({ q: a.q, verdict: a.verdict, label: VERDICT_LABEL[a.verdict], reason: a.reason, counted: a.counted, newClues: a.newClues, reClues: a.reClues || [] })),
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
