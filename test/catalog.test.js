import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUZZLES } from '../server/puzzles.js';
import { CASE_ART, imgSrc } from '../public/cases.js';
import * as G from '../server/game.js';

test('每个案件都有唯一编号和实际 WebP 完整图、缩略图', async () => {
  const ids = PUZZLES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, '案件 ID 不得重复');
  assert.deepEqual(Object.keys(CASE_ART).sort(), [...ids].sort());
  assert.equal(new Set(Object.values(CASE_ART).map((a) => a.no)).size, ids.length);
  for (const p of PUZZLES) {
    const art = CASE_ART[p.id];
    assert.ok(art.alt && art.tagline && art.pos && art.endPos, p.id);
    for (const small of [false, true]) {
      const bytes = await readFile(new URL(`../public/${imgSrc(p.id, small)}`, import.meta.url));
      assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', p.id);
      assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', p.id);
      assert.ok(bytes.length > 1000, p.id);
    }
  }
});

test('每案提示逐次公开；结案前不会提供汤底、事实清单或未用提示', () => {
  for (const p of PUZZLES) {
    assert.equal(p.hints.length, G.MAX_HINTS, p.id);
    assert.ok(p.hints.every((h) => h.trim()), p.id);
    assert.ok(p.nudges.length >= 2, p.id);
    const s = G.newSession(p);
    for (let used = 0; used <= G.MAX_HINTS; used++) {
      s.hintsUsed = used;
      const st = G.publicState(s, p);
      assert.equal(st.reveal, undefined, p.id);
      assert.equal(st.puzzle.truth, undefined, p.id);
      assert.equal(st.puzzle.facts, undefined, p.id);
      assert.equal(st.puzzle.world, undefined, p.id);
      assert.deepEqual(st.hints, p.hints.slice(0, used), p.id);
    }
  }
});

test('完整事实能结案；漏掉任何核心事实仍不能靠已解锁线索结案', () => {
  for (const p of PUZZLES) {
    const ids = p.facts.map((f) => f.id);
    assert.equal(G.scoreSubmission(p, ids).score, 100, p.id);
    assert.equal(G.scoreSubmission(p, ids).passed, true, p.id);
    for (const f of p.facts.filter((f) => f.core)) {
      assert.equal(G.scoreSubmission(p, ids.filter((id) => id !== f.id), [], ids).passed, false, `${p.id}/${f.id}`);
    }
  }
});
