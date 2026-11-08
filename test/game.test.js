import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES, validatePuzzle } from '../server/puzzles.js';
import * as G from '../server/game.js';

const p = PUZZLES[0];

test('题库合法：权重和为100、有core、id不重复', () => {
  for (const x of PUZZLES) assert.deepEqual(validatePuzzle(x), []);
});

test('sanitizeJudge：非法verdict降级、非yes不解锁、过滤不存在的id', () => {
  assert.equal(G.sanitizeJudge({ verdict: 'maybe' }, p).verdict, 'unknown');
  assert.deepEqual(G.sanitizeJudge({ verdict: 'no', matched_fact_ids: ['f1'] }, p).matched, []);
  assert.deepEqual(G.sanitizeJudge({ verdict: 'yes', matched_fact_ids: ['f1', 'zzz'] }, p).matched, ['f1']);
});

test('泄底的理由被替换为默认文案', () => {
  const r = G.sanitizeJudge({ verdict: 'unknown', reason: '因为他是盲人' }, p);
  assert.equal(r.reason, '故事里没有交代');
  const r2 = G.sanitizeJudge({ verdict: 'unknown', reason: '像往常一样坐在桌边' }, p); // 与汤底5字重合
  assert.equal(r2.reason, '故事里没有交代');
});

test('invalid不扣次数；线索只在首次命中时解锁', () => {
  const s = G.newSession(p);
  G.applyAsk(s, p, '为什么报警', { verdict: 'invalid', matched: [], reason: 'x' });
  assert.equal(G.remaining(s), 40);
  const e1 = G.applyAsk(s, p, '他是盲人吗', { verdict: 'yes', matched: ['f1'], reason: '' });
  const e2 = G.applyAsk(s, p, '他看不见吗', { verdict: 'yes', matched: ['f1'], reason: '' });
  assert.deepEqual(e1.newClues, ['f1']);
  assert.deepEqual(e2.newClues, []);
  assert.equal(G.remaining(s), 38);
  assert.equal(G.progress(s, p), 15);
});

test('重复问题识别忽略标点空格', () => {
  const s = G.newSession(p);
  G.applyAsk(s, p, '他是盲人吗？', { verdict: 'yes', matched: [], reason: '' });
  assert.ok(G.findDuplicate(s, '他是 盲人吗'));
  assert.equal(G.findDuplicate(s, '他是男人吗'), undefined);
});

test('判分：缺core不过；core齐+够分通过；partial算一半', () => {
  const core = p.facts.filter((f) => f.core).map((f) => f.id);
  assert.equal(G.scoreSubmission(p, ['f1', 'f2', 'f3', 'f6']).passed, false);
  assert.equal(G.scoreSubmission(p, [...core, 'f2', 'f3']).passed, true); // 15+20+20+15=70
  assert.equal(G.scoreSubmission(p, core, ['f2']).score, 45);
});

test('publicState 进行中不含汤底', () => {
  const s = G.newSession(p);
  const st = G.publicState(s, p);
  assert.equal(st.reveal, undefined);
  assert.ok(!JSON.stringify(st).includes(p.truth));
  s.status = 'gaveup';
  assert.equal(G.publicState(s, p).reveal.truth, p.truth);
});

test('判分：提问中已解锁的非核心事实计入；核心事实仍须在推理中说出', () => {
  const core = p.facts.filter((f) => f.core).map((f) => f.id);
  const nonCore = p.facts.filter((f) => !f.core).map((f) => f.id);
  // 推理只写出核心事实，但非核心都已在提问中解锁 → 通过
  assert.equal(G.scoreSubmission(p, core, [], nonCore).passed, true);
  // 核心事实在提问中解锁、但推理没说出 → 不通过
  assert.equal(G.scoreSubmission(p, nonCore, [], [...core, ...nonCore]).coreOk, false);
});

test('重复命中同一事实不重复解锁，记入 reClues；解锁序号按计数问题', () => {
  const s = G.newSession(p);
  G.applyAsk(s, p, '为什么', { verdict: 'invalid', matched: [], reason: '' });
  G.applyAsk(s, p, '他是盲人吗', { verdict: 'yes', matched: ['f1'], reason: '' });
  const e = G.applyAsk(s, p, '他看不见吗', { verdict: 'yes', matched: ['f1'], reason: '' });
  assert.deepEqual(e.reClues, ['f1']);
  assert.equal(G.publicState(s, p).clues[0].no, 1);
});
