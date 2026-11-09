import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDirectory } from './data-directory.js';

export const SESSION_TTL = 6 * 3600_000;
const clone = (value) => structuredClone(value);
const usable = (s) => s && typeof s.id === 'string' && /^[a-f0-9-]{36}$/i.test(s.id)
  && typeof s.puzzleId === 'string' && Number.isFinite(s.createdAt)
  && Number.isFinite(s.updatedAt ?? s.createdAt) && Array.isArray(s.asked)
  && Array.isArray(s.unlocked) && s.unlockedBy && typeof s.unlockedBy === 'object'
  && ['playing', 'won', 'lost', 'gaveup'].includes(s.status)
  && Number.isInteger(s.hintsUsed) && Number.isInteger(s.submits) && Number.isInteger(s.llmCalls);

// Only server-owned state is accepted. The browser receives an opaque session ID,
// never a client-editable save containing facts, answers, or score authority.
export async function createSessionStore({ directory, now = Date.now, ttl = SESSION_TTL, validPuzzle = () => true } = {}) {
  const dir = getDataDirectory(directory), file = join(dir, 'solo-sessions.json');
  let sessions = new Map(), usage = { day: new Date(now()).toDateString(), calls: 0 }, queue = Promise.resolve();
  const active = (s) => now() - (s.updatedAt ?? s.createdAt) < ttl;
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw?.version !== 1 || !Array.isArray(raw.sessions)) throw new Error('format');
    sessions = new Map(raw.sessions.filter((s) => usable(s) && validPuzzle(s.puzzleId) && active(s)).map((s) => [s.id, s]));
    if (typeof raw.usage?.day === 'string' && Number.isInteger(raw.usage.calls) && raw.usage.calls >= 0) usage = raw.usage;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Do not silently overwrite a damaged save with an empty catalog.
      throw Object.assign(new Error('单人存档无法读取，请检查数据目录后重启服务'), { code: 'SESSION_STORE_READ' });
    }
  }
  const serialize = (job) => {
    const pending = queue.then(job);
    queue = pending.catch(() => {}); // A failed write must not poison later retries.
    return pending;
  };
  async function write(next, nextUsage) {
    const tmp = join(dir, `.solo-sessions-${randomUUID()}.tmp`);
    let handle;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      handle = await open(tmp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, usage: nextUsage, sessions: [...next.values()] }));
      await handle.sync();
      await handle.close(); handle = null;
      await rename(tmp, file);
    } catch {
      throw Object.assign(new Error('存档暂时无法保存，请稍后重试'), { status: 503, code: 'SESSION_STORE_WRITE' });
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(tmp).catch(() => {});
    }
  }
  const retained = () => new Map([...sessions].filter(([, s]) => active(s)));
  return {
    get(id) { const s = sessions.get(id); return s && active(s) ? clone(s) : null; },
    usage() { return clone(usage); },
    commit(session) {
      const candidate = clone(session);
      if (!usable(candidate) || !validPuzzle(candidate.puzzleId)) return Promise.reject(new Error('Invalid server session'));
      return serialize(async () => {
        candidate.updatedAt = now();
        const next = retained(); next.set(candidate.id, candidate);
        await write(next, usage);
        sessions = next;
        return clone(candidate);
      });
    },
    saveUsage(value) {
      const nextUsage = clone(value);
      return serialize(async () => {
        const next = retained();
        await write(next, nextUsage);
        sessions = next; usage = nextUsage;
      });
    },
    prune() {
      return serialize(async () => {
        const next = retained();
        if (next.size === sessions.size) return;
        await write(next, usage); sessions = next;
      });
    },
    flush() { return queue; },
  };
}
