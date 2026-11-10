import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createSessionStore, SESSION_TTL } from '../server/session-store.js';
import { newSession, applyAsk } from '../server/game.js';
import { PUZZLES } from '../server/puzzles.js';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'soup-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('单人存档：已提交问答、线索与用量在重启后保留；读副本不能篡改存档', async (t) => {
  const directory = await temporary(t), p = PUZZLES[0];
  const store = await createSessionStore({ directory });
  const s = newSession(p);
  applyAsk(s, p, '他是盲人吗？', { verdict: 'yes', matched: ['f1'], reason: '' });
  s.hintsUsed = 1; s.llmCalls = 1;
  await store.saveUsage({ day: 'test-day', calls: 8 });
  await store.commit(s);
  const copy = store.get(s.id); copy.hintsUsed = 3; copy.asked[0].q = 'changed';
  const reopened = await createSessionStore({ directory });
  assert.equal(reopened.get(s.id).hintsUsed, 1);
  assert.equal(reopened.get(s.id).asked[0].q, '他是盲人吗？');
  assert.deepEqual(reopened.get(s.id).unlocked, ['f1']);
  assert.equal(reopened.usage().calls, 8);
  assert.equal((await stat(join(directory, 'solo-sessions.json'))).mode & 0o777, 0o600);
});

test('并发存档保留不同对局，过期基于最后活动而非创建时间', async (t) => {
  const directory = await temporary(t); let time = 100_000_000;
  const store = await createSessionStore({ directory, now: () => time });
  const a = { ...newSession(PUZZLES[0]), createdAt: time };
  const b = { ...newSession(PUZZLES[1]), createdAt: time };
  await Promise.all([store.commit(a), store.commit(b)]);
  time += SESSION_TTL - 1000;
  await store.commit(store.get(a.id));
  time += 2000;
  assert.ok(store.get(a.id)); assert.equal(store.get(b.id), null);
  await store.prune();
  const reopened = await createSessionStore({ directory, now: () => time });
  assert.ok(reopened.get(a.id)); assert.equal(reopened.get(b.id), null);
  time += SESSION_TTL;
  assert.equal(reopened.get(a.id), null);
});

test('落盘失败不发布新状态，恢复目录后可以重试，损坏文件不会被覆盖', async (t) => {
  const directory = await temporary(t);
  const store = await createSessionStore({ directory });
  const s = newSession(PUZZLES[0]); await store.commit(s);
  const original = await readFile(join(directory, 'solo-sessions.json'), 'utf8');
  // Turn the store directory into a file to force failure even when tests run as root.
  const { rename } = await import('node:fs/promises');
  const backup = directory + '-backup';
  await rename(directory, backup); await writeFile(directory, 'blocked');
  t.after(() => rm(backup, { recursive: true, force: true }));
  const changed = store.get(s.id); changed.hintsUsed = 2;
  await assert.rejects(store.commit(changed), { code: 'SESSION_STORE_WRITE' });
  assert.equal(store.get(s.id).hintsUsed, 0);
  await rm(directory); await rename(backup, directory);
  assert.equal(await readFile(join(directory, 'solo-sessions.json'), 'utf8'), original);
  await store.commit(changed);
  assert.equal(store.get(s.id).hintsUsed, 2);
  await writeFile(join(directory, 'solo-sessions.json'), '{broken');
  await assert.rejects(createSessionStore({ directory }), { code: 'SESSION_STORE_READ' });
  assert.equal(await readFile(join(directory, 'solo-sessions.json'), 'utf8'), '{broken');
});

test('持久目录跨部署续局：更换代码目录和重启后仍恢复同一局', { timeout: 20_000 }, async (t) => {
  const root = await temporary(t), directory = join(root, 'persistent-data');
  const firstRelease = join(root, 'release-a'), secondRelease = join(root, 'release-b');
  await Promise.all([mkdir(firstRelease), mkdir(secondRelease)]);
  const children = new Set();
  t.after(async () => { for (const child of children) { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } } });
  async function start(release) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../server/index.js', import.meta.url))], {
      cwd: release,
      env: { ...process.env, PORT: '0', DATA_DIR: directory, DATA_PERSISTENT: '1', SESSION_TTL_DAYS: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', VOLC_SPEECH_API_KEY: '', ACCESS_CODE: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 8000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Test server exited before listening')); });
      child.stdout.on('data', (chunk) => {
        const found = chunk.toString().match(/http:\/\/localhost:(\d+)/);
        if (found) { clearTimeout(timer); resolve('http://127.0.0.1:' + found[1]); }
      });
    });
    return { child, base };
  }
  async function post(base, path, body) {
    const res = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200); return res.json();
  }
  const first = await start(firstRelease);
  const session = await post(first.base, 'new', { puzzleId: 'blind-meal' });
  const hints = await Promise.all([post(first.base, 'hint', { sid: session.sid }), post(first.base, 'hint', { sid: session.sid })]);
  assert.deepEqual(hints.map((h) => h.hintsLeft).sort(), [1, 2]);
  first.child.kill(); await once(first.child, 'exit'); children.delete(first.child);
  await rm(firstRelease, { recursive: true });
  const second = await start(secondRelease);
  const resumed = await (await fetch(second.base + '/api/state?sid=' + session.sid)).json();
  assert.equal(resumed.hintsLeft, 1);
  assert.equal(resumed.status, 'playing'); assert.equal(resumed.remaining, 40);
  assert.equal(resumed.reveal, undefined);
  const ended = await post(second.base, 'giveup', { sid: session.sid });
  assert.equal(ended.status, 'gaveup');
});

test('30天保存期与持久化标记必须由部署明确确认', async (t) => {
  const directory = await temporary(t); let time = Date.now();
  const local = await createSessionStore({ directory, now: () => time });
  assert.deepEqual(local.metadata, { kind: 'file', durable: false, retentionDays: 30 });
  const s = newSession(PUZZLES[0]); await local.commit(s); await local.close();
  time += 3 * 24 * 3600_000;
  const persistent = await createSessionStore({ directory, persistent: true, now: () => time });
  assert.ok(persistent.get(s.id));
  assert.deepEqual(persistent.metadata, { kind: 'file', durable: true, retentionDays: 30 });
  await persistent.commit(persistent.get(s.id));
  time += SESSION_TTL - 1;
  assert.ok(persistent.get(s.id));
  time += 1;
  assert.equal(persistent.get(s.id), null);
});
