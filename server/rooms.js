import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDirectory } from './data-directory.js';
import * as G from './game.js';
import { getPuzzle } from './puzzles.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (value, max) => Array.from(String(value || '').trim().replace(/[\x00-\x1f]/g, '')).slice(0, max).join('');
const same = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };

export function mountRooms(app, { judge, grade, spend, accessCode = '', dataDirectory }) {
  const rooms = new Map(), streams = new Map(), epoch = randomUUID();
  const dir = getDataDirectory(dataDirectory), file = join(dir, 'rooms.json');
  try {
    for (const r of JSON.parse(readFileSync(file, 'utf8'))) {
      if (Date.now() - r.createdAt > 6 * 3600_000 || !getPuzzle(r.puzzleId)) continue;
      r.players = new Map(r.players.map((p) => [p.id, { ...p, connected: false, speaking: false, voiceJoined: false }]));
      r.busy = null; rooms.set(r.code, r);
    }
  } catch {}
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const data = [...rooms.values()].map((r) => ({ ...r, busy: null, players: [...r.players.values()].map((p) => ({ ...p, connected: false, speaking: false, voiceJoined: false })) }));
        writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 }); renameSync(file + '.tmp', file);
      } catch (e) { console.error('Room persistence failed:', e.code || 'write'); }
    }, 100); saveTimer.unref();
  }
  function chat(r, name, text, system = false) {
    r.chat.push({ id: randomUUID(), name, text, system, time: Date.now() }); r.chat = r.chat.slice(-80);
  }
  function game(r) {
    if (!r.session) return null;
    const s = G.publicState(r.session, getPuzzle(r.puzzleId));
    s.log = s.log.map((l, i) => ({ ...l, by: r.session.asked[i].by || '玩家' }));
    return s;
  }
  function snapshot(r, me) {
    const present = [...r.players.values()].filter((p) => p.connected);
    return { code: r.code, epoch, meId: me, hostId: r.hostId, phase: r.phase, puzzleId: r.puzzleId, revision: r.revision,
      gameRevision: r.gameRevision, game: game(r), busy: r.busy, chat: r.chat, result: r.lastResult || null,
      canStart: r.phase === 'lobby' && present.length > 0 && present.every((p) => p.ready),
      players: [...r.players.values()].map(({ id, name, ready, connected, voiceJoined, muted, speaking }) => ({ id, name, ready, connected, voiceJoined, muted, speaking })) };
  }
  function push(res, type, data) { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  function broadcast(r, persist = true) {
    r.revision++;
    for (const [id, set] of streams.get(r.code) || []) for (const res of set) push(res, 'room', snapshot(r, id));
    if (persist) save();
  }
  function roomOf(code) { const r = rooms.get(String(code).toUpperCase()); if (!r) throw fail(404, '房间不存在或已过期'); return r; }
  function playerOf(req, r) {
    const key = 'ts_room_' + r.code;
    const cookie = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(key + '='));
    const token = cookie ? cookie.slice(key.length + 1) : '';
    const p = [...r.players.values()].find((p) => same(p.token, token));
    if (!p) throw fail(403, '请从邀请入口加入房间');
    return p;
  }
  function addPlayer(req, res, r, name) {
    let p; try { p = playerOf(req, r); } catch {}
    if (!p) {
      if (r.players.size >= 8) throw fail(409, '房间已经坐满了，最多 8 人');
      p = { id: randomUUID(), token: randomBytes(24).toString('hex'), name: clean(name, 12) || `旅人${r.players.size + 1}`, ready: false, connected: false, voiceJoined: false, muted: true, speaking: false };
      r.players.set(p.id, p); chat(r, '系统', `${p.name} 来到了推理室`, true);
    }
    res.cookie('ts_room_' + r.code, p.token, { httpOnly: true, sameSite: 'lax', path: '/api/rooms/' + r.code, maxAge: 6 * 3600_000 });
    return p;
  }
  const route = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { if (!e.status) console.error('Room request:', e.message); if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : '房间暂时没有响应，请重试' }); }
  };
  const get = (req) => { const r = roomOf(req.params.code); return [r, playerOf(req, r)]; };
  const host = (r, p) => { if (r.hostId !== p.id) throw fail(403, '这项操作由房主完成'); };
  const playable = (r) => { if (!r.session || r.session.status !== 'playing') throw fail(409, '本局尚未开始或已经结束'); if (r.busy) throw fail(409, '裁判正在回应同伴的问题，请稍等'); };
  async function judging(r, p, q, fn) {
    r.busy = { by: p.name, q }; broadcast(r, false);
    try { return await fn(); }
    finally { r.busy = null; broadcast(r); }
  }

  app.post('/api/rooms', route(async (req, res) => {
    if (accessCode && req.body.code !== accessCode) throw fail(403, '体验口令不对');
    let code; do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
    const puzzle = getPuzzle(req.body.puzzleId) || getPuzzle('blind-meal');
    const r = { code, createdAt: Date.now(), hostId: '', players: new Map(), phase: 'lobby', puzzleId: puzzle.id, session: null, chat: [], revision: 0, gameRevision: 0, busy: null };
    const p = addPlayer(req, res, r, req.body.name); r.hostId = p.id; p.ready = true; rooms.set(code, r); save();
    res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/join', route(async (req, res) => {
    const r = roomOf(req.params.code), p = addPlayer(req, res, r, req.body.name); broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.get('/api/rooms/:code/events', route(async (req, res) => {
    const [r, p] = get(req); p.connected = true;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    let members = streams.get(r.code); if (!members) streams.set(r.code, members = new Map());
    let set = members.get(p.id); if (!set) members.set(p.id, set = new Set()); set.add(res);
    broadcast(r, false);
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 15000); ping.unref();
    req.on('close', () => {
      clearInterval(ping); set.delete(res);
      if (!set.size && r.players.has(p.id)) {
        p.connected = false; p.speaking = false; p.voiceJoined = false; broadcast(r, false);
        const grace = setTimeout(() => {
          if (p.connected || !r.players.has(p.id)) return;
          r.players.delete(p.id); members.delete(p.id); chat(r, '系统', `${p.name} 已离线，座位已空出`, true);
          if (!r.players.size) { rooms.delete(r.code); streams.delete(r.code); save(); return; }
          if (r.hostId === p.id) { const next = [...r.players.values()].find((x) => x.connected) || r.players.values().next().value; r.hostId = next.id; next.ready = true; }
          broadcast(r);
        }, 90000); grace.unref();
      }
    });
  }));
  app.post('/api/rooms/:code/ready', route(async (req, res) => {
    const [r, p] = get(req); if (r.phase !== 'lobby') throw fail(409, '本局已经开始');
    p.ready = p.id === r.hostId || Boolean(req.body.ready); broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/select', route(async (req, res) => {
    const [r, p] = get(req); host(r, p); if (r.phase !== 'lobby') throw fail(409, '请先回到房间再更换卷宗');
    const puzzle = getPuzzle(req.body.puzzleId); if (!puzzle) throw fail(400, '没有这份卷宗');
    r.puzzleId = puzzle.id; broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/start', route(async (req, res) => {
    const [r, p] = get(req); host(r, p);
    if (r.phase !== 'lobby') throw fail(409, '本局已经开始');
    const present = [...r.players.values()].filter((p) => p.connected);
    if (!present.length || present.some((p) => !p.ready)) throw fail(409, '等同伴都准备好后再开始');
    r.session = G.newSession(getPuzzle(r.puzzleId)); r.phase = 'playing'; r.gameRevision++; r.lastResult = null;
    chat(r, '系统', '卷宗已经打开。大家共用 40 次提问机会。', true); broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/ask', route(async (req, res) => {
    const [r, p] = get(req); playable(r);
    const q = String(req.body.q || '').trim(); if (!q || q.length > 160) throw fail(400, '请输入 160 字以内的是非问题');
    if (G.remaining(r.session) <= 0) throw fail(409, '提问次数已用完，请提交推理');
    const duplicate = G.findDuplicate(r.session, q);
    if (duplicate) return res.json({ ...snapshot(r, p.id), notice: `问过了：「${duplicate.q}」→ ${G.VERDICT_LABEL[duplicate.verdict]}，不扣次数` });
    await judging(r, p, q, async () => {
      spend(r.session); const puzzle = getPuzzle(r.puzzleId);
      G.applyAsk(r.session, puzzle, q, G.sanitizeJudge(await judge(puzzle, r.session.asked, q), puzzle), p.name); r.gameRevision++;
    });
    res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/hint', route(async (req, res) => {
    const [r, p] = get(req); playable(r); const puzzle = getPuzzle(r.puzzleId);
    if (r.session.hintsUsed >= Math.min(G.MAX_HINTS, puzzle.hints.length)) throw fail(409, '共享提示已用完');
    r.session.hintsUsed++; r.gameRevision++; chat(r, '系统', `${p.name} 使用了一次共享提示`, true); broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/submit', route(async (req, res) => {
    const [r, p] = get(req); playable(r); const answer = String(req.body.answer || '').trim();
    if (!answer || answer.length > 600) throw fail(400, '请填写 600 字以内的完整推理');
    await judging(r, p, '正在审阅完整推理', async () => {
      spend(r.session); const puzzle = getPuzzle(r.puzzleId), g = await grade(puzzle, answer);
      const covered = [...new Set(g.covered)], result = G.scoreSubmission(puzzle, covered, g.partial, r.session.unlocked);
      r.session.submits++;
      if (result.passed) r.session.status = 'won'; else if (r.session.submits >= G.MAX_SUBMITS) r.session.status = 'lost';
      r.session.lastSubmitGaps = result.passed ? null : { dims: G.gapDims(result.missing), score: result.score, comment: g.comment };
      for (const id of covered) if (!r.session.unlocked.includes(id)) { r.session.unlocked.push(id); r.session.unlockedBy[id] = '（推理中说出）'; }
      r.session.lastScore = result.score; r.lastResult = { passed: result.passed, score: result.score, comment: g.comment };
      if (r.session.status !== 'playing') r.phase = 'ended';
      r.gameRevision++; chat(r, '系统', `${p.name} 提交了完整推理${result.passed ? '，本局成功结案' : ''}`, true);
    }); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/giveup', route(async (req, res) => {
    const [r, p] = get(req); host(r, p); playable(r); r.session.status = 'gaveup'; r.phase = 'ended'; r.gameRevision++;
    chat(r, '系统', `${p.name} 揭晓了本局汤底`, true); broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/reset', route(async (req, res) => {
    const [r, p] = get(req); host(r, p); if (r.busy) throw fail(409, '裁判正在处理本局，请稍等');
    r.phase = 'lobby'; r.session = null; r.lastResult = null; r.gameRevision++;
    for (const player of r.players.values()) player.ready = player.id === r.hostId;
    chat(r, '系统', '大家回到了房间，准备下一宗。', true); broadcast(r); res.json(snapshot(r, p.id));
  }));
  app.post('/api/rooms/:code/chat', route(async (req, res) => {
    const [r, p] = get(req), text = clean(req.body.text, 200); if (!text) throw fail(400, '先写点什么');
    if (Date.now() - (p.lastChat || 0) < 600) throw fail(429, '稍等一下再发送'); p.lastChat = Date.now();
    chat(r, p.name, text); broadcast(r); res.json({ ok: true });
  }));
  app.post('/api/rooms/:code/voice', route(async (req, res) => {
    const [r, p] = get(req); p.voiceJoined = Boolean(req.body.joined); p.muted = !p.voiceJoined || Boolean(req.body.muted); p.speaking = !p.muted && Boolean(req.body.speaking);
    broadcast(r, false); res.json({ ok: true });
  }));
  app.post('/api/rooms/:code/signal', route(async (req, res) => {
    const [r, p] = get(req), target = String(req.body.target || ''), data = req.body.data;
    if (!r.players.has(target) || !data || JSON.stringify(data).length > 7000 || (!data.description && !data.candidate)) throw fail(400, '无效的语音信令');
    for (const stream of streams.get(r.code)?.get(target) || []) push(stream, 'signal', { from: p.id, data });
    res.json({ ok: true });
  }));
  app.post('/api/rooms/:code/leave', route(async (req, res) => {
    const [r, p] = get(req); r.players.delete(p.id); chat(r, '系统', `${p.name} 离开了房间`, true);
    for (const stream of streams.get(r.code)?.get(p.id) || []) stream.end(); streams.get(r.code)?.delete(p.id);
    if (!r.players.size) rooms.delete(r.code);
    else { if (r.hostId === p.id) { const next = [...r.players.values()].find((p) => p.connected) || r.players.values().next().value; r.hostId = next.id; next.ready = true; } broadcast(r); }
    res.clearCookie('ts_room_' + r.code, { path: '/api/rooms/' + r.code }); save(); res.json({ ok: true });
  }));
  const cleanup = setInterval(() => { for (const [code, r] of rooms) if (Date.now() - r.createdAt > 6 * 3600_000) { for (const set of streams.get(code)?.values() || []) for (const s of set) s.end(); streams.delete(code); rooms.delete(code); } }, 600_000); cleanup.unref();
  return { speechState(req) { const r = roomOf(req.body.room); playerOf(req, r); return game(r); }, close() { clearInterval(cleanup); clearTimeout(saveTimer); for (const members of streams.values()) for (const set of members.values()) for (const res of set) res.end(); } };
}
