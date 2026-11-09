// HTTP 服务：每个访客一个独立会话；汤底只在服务端。
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PUZZLES, getPuzzle, validatePuzzle } from './puzzles.js';
import * as G from './game.js';
import { judge, grade, llmMode } from './llm.js';
import { mountRooms } from './rooms.js';
import { networkInterfaces } from 'node:os';
import { mountSpeech, speechMeta } from './tts.js';
import { createSessionStore } from './session-store.js';

const PORT = Number(process.env.PORT || 8787);
const ACCESS_CODE = process.env.ACCESS_CODE || ''; // 设置后，访客需输入口令才能开局（防止链接外传刷 API）
const DAILY_LLM_LIMIT = Number(process.env.DAILY_LLM_LIMIT || 2000); // 全站每日调用上限
const PER_SESSION_LLM_LIMIT = 70;

for (const p of PUZZLES) {
  const errs = validatePuzzle(p);
  if (errs.length) throw new Error(errs.join('\n'));
}

const sessions = await createSessionStore({ validPuzzle: (id) => Boolean(getPuzzle(id)) });
let usage = sessions.usage();
function spend(s) {
  const today = new Date().toDateString();
  if (usage.day !== today) usage = { day: today, calls: 0 };
  if (usage.calls >= DAILY_LLM_LIMIT) throw httpErr(429, '今日体验名额已用完，明天再来吧');
  if (s.llmCalls >= PER_SESSION_LLM_LIMIT) throw httpErr(429, '本局调用次数已达上限');
  usage.calls++;
  s.llmCalls++;
  return sessions.saveUsage(usage);
}

// 距最后一次成功操作或继续对局 6 小时后过期，服务重启可从 DATA_DIR 恢复。
setInterval(() => {
  sessions.prune().catch((e) => console.error('Session persistence:', e.code));
}, 600_000).unref();

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

// 同一会话的请求串行处理，避免并发提问导致次数和线索状态错乱
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const cur = new Promise((r) => (release = r));
  const tail = prev.then(() => cur);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

function load(req) {
  const s = sessions.get(req.body?.sid || req.query.sid);
  if (!s) throw httpErr(404, '对局不存在或已过期，请重新开局');
  return [s, getPuzzle(s.puzzleId)];
}
// Read after entering the lock: a request queued behind another must use its
// committed state, not an earlier copy with stale counters.
const withSession = (req, fn) => withLock(String(req.body?.sid || req.query.sid || ''), () => fn(...load(req)));
const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : '裁判开小差了，请再试一次' });
  }
};
const text = (v, max) => {
  const t = String(v ?? '').trim();
  if (!t) throw httpErr(400, '内容不能为空');
  if (t.length > max) throw httpErr(400, `不能超过 ${max} 字`);
  return t;
};

app.get('/api/meta', (_req, res) =>
  res.json({
    mode: llmMode(),
    needCode: Boolean(ACCESS_CODE),
    rooms: true,
    speech: speechMeta(),
    lanUrl: (() => { const ip = Object.values(networkInterfaces()).flat().find((a) => a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)); return ip ? `http://${ip.address}:${PORT}` : null; })(),
    puzzles: PUZZLES.map((p) => ({ id: p.id, title: p.title, tag: p.tag, difficulty: p.difficulty, surface: p.surface, collection: p.collection || 'horror' })),
  }),
);

const roomService = mountRooms(app, { judge, grade, spend, accessCode: ACCESS_CODE });
mountSpeech(app, { accessCode: ACCESS_CODE, stateFor(req) {
  if (req.body.room) return roomService.speechState(req);
  const [s, p] = load(req); return G.publicState(s, p);
} });

app.post('/api/new', route(async (req) => {
  if (ACCESS_CODE && req.body?.code !== ACCESS_CODE) throw httpErr(403, '口令不对');
  const p = getPuzzle(req.body?.puzzleId) || PUZZLES[0];
  const s = G.newSession(p);
  await sessions.commit(s);
  return G.publicState(s, p);
}));

app.get('/api/state', route((req) => withSession(req, async (s, p) => {
  await sessions.commit(s);
  return G.publicState(s, p);
})));

app.post('/api/ask', route((req) => withSession(req, async (s, p) => {
    if (s.status !== 'playing') throw httpErr(409, '本局已结束');
    if (G.remaining(s) <= 0) throw httpErr(409, '提问次数已用完，请提交推理');
    const q = text(req.body.q, 160);
    const dup = G.findDuplicate(s, q);
    if (dup) return { ...G.publicState(s, p), notice: `这个问题问过了：「${dup.q}」→ ${G.VERDICT_LABEL[dup.verdict]}（不扣次数）` };
    await spend(s);
    await sessions.commit(s);
    const judged = G.sanitizeJudge(await judge(p, s.asked, q), p);
    const entry = G.applyAsk(s, p, q, judged);
    await sessions.commit(s);
    return { ...G.publicState(s, p), last: { ...entry, label: G.VERDICT_LABEL[entry.verdict] } };
})));

app.post('/api/hint', route((req) => withSession(req, async (s, p) => {
    if (s.status !== 'playing') throw httpErr(409, '本局已结束');
    if (s.hintsUsed >= Math.min(G.MAX_HINTS, p.hints.length)) throw httpErr(409, '提示已用完');
    s.hintsUsed++;
    await sessions.commit(s);
    return G.publicState(s, p);
})));

app.post('/api/submit', route((req) => withSession(req, async (s, p) => {
    if (s.status !== 'playing') throw httpErr(409, '本局已结束');
    const answer = text(req.body.answer, 600);
    await spend(s);
    await sessions.commit(s);
    const g = await grade(p, answer);
    // 非核心事实：提问中已解锁即算已知（在 scoreSubmission 内合并）；核心事实必须在推理中说出
    const covered = [...new Set(g.covered)];
    const r = G.scoreSubmission(p, covered, g.partial, s.unlocked);
    s.submits++;
    if (r.passed) s.status = 'won';
    else if (s.submits >= G.MAX_SUBMITS) s.status = 'lost';
    s.lastSubmitGaps = r.passed ? null : { dims: G.gapDims(r.missing), score: r.score, comment: g.comment };
    for (const id of covered) if (!s.unlocked.includes(id)) { s.unlocked.push(id); s.unlockedBy[id] = '（推理中说出）'; }
    s.lastScore = r.score;
    await sessions.commit(s);
    return { ...G.publicState(s, p), result: { passed: r.passed, score: r.score, comment: g.comment } };
})));

app.post('/api/giveup', route((req) => withSession(req, async (s, p) => {
  if (s.status === 'playing') s.status = 'gaveup';
  await sessions.commit(s);
  return G.publicState(s, p);
})));

const server = app.listen(PORT, () => console.log(`海龟汤 demo 已启动: http://localhost:${server.address().port}  模式: ${llmMode()}${ACCESS_CODE ? '  口令已开启' : ''}`));
