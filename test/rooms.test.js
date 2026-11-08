import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mountRooms } from '../server/rooms.js';
import { PUZZLES } from '../server/puzzles.js';

test('真实房间：身份、准备、共享次数、并发保护、汤底保密与房主转移', async () => {
  const dir = mkdtempSync(tmpdir() + '/weiming-rooms-');
  const app = express(); app.use(express.json());
  let release, called; const began = new Promise((r) => called = r); let calls = 0;
  const rooms = mountRooms(app, { dataDirectory: dir, spend: () => calls++, judge: async () => { called(); await new Promise((r) => release = r); return { verdict: 'yes', matched_fact_ids: ['f1'] }; }, grade: async () => ({ covered: PUZZLES[0].facts.map((f) => f.id), partial: [], comment: '已还原。' }) });
  const server = app.listen(0); await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const streams = [];
  async function post(path, cookie, body = {}) { const r = await fetch(base + '/api/rooms' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; }
  async function connect(code, cookie) { const c = new AbortController(); streams.push(c); const r = await fetch(base + '/api/rooms/' + code + '/events', { headers: { cookie }, signal: c.signal }); assert.equal(r.status, 200); }
  try {
    const h = await post('', '', { name: '甲', puzzleId: 'blind-meal' }); const code = h.body.code, path = '/' + code;
    assert.equal(h.status, 200); assert.ok(!JSON.stringify(h.body).includes('token'));
    const g = await post(path + '/join', '', { name: '乙' });
    await connect(code, h.cookie); await connect(code, g.cookie);
    assert.equal((await post(path + '/start', g.cookie)).status, 403);
    assert.equal((await post(path + '/start', h.cookie)).status, 409);
    assert.equal((await post(path + '/ready', g.cookie, { ready: true })).status, 200);
    const started = await post(path + '/start', h.cookie);
    assert.equal(started.body.game.remaining, 40);
    assert.equal(started.body.game.reveal, undefined);
    assert.ok(!JSON.stringify(started.body).includes(PUZZLES[0].truth));
    assert.equal((await post(path + '/ask', '', { q: '他看不见吗？' })).status, 403);
    const asking = post(path + '/ask', g.cookie, { q: '他看不见吗？' }); await began;
    assert.equal((await post(path + '/ask', h.cookie, { q: '他是男人吗？' })).status, 409);
    release(); const answer = await asking;
    assert.equal(answer.body.game.remaining, 39); assert.equal(answer.body.game.log[0].by, '乙'); assert.equal(answer.body.game.clues.length, 1); assert.equal(calls, 1);
    const duplicate = await post(path + '/ask', h.cookie, { q: '他 看不见吗' });
    assert.equal(duplicate.body.game.remaining, 39); assert.ok(duplicate.body.notice); assert.equal(calls, 1);
    assert.equal((await post(path + '/chat', g.cookie, { text: '<script>讨论</script>' })).status, 200);
    const ended = await post(path + '/submit', g.cookie, { answer: '完整还原测试' });
    assert.equal(ended.body.phase, 'ended'); assert.equal(ended.body.game.status, 'won'); assert.equal(ended.body.game.reveal.truth, PUZZLES[0].truth);
    assert.equal((await post(path + '/leave', h.cookie)).status, 200);
    const transferred = await post(path + '/join', g.cookie, { name: '乙' });
    assert.equal(transferred.body.hostId, g.body.meId); assert.equal(transferred.body.players.length, 1);
    assert.equal((await post(path + '/reset', g.cookie)).body.phase, 'lobby');
  } finally { streams.forEach((c) => c.abort()); rooms.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
