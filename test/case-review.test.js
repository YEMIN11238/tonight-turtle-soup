import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReview, recommendNext } from '../public/case-review.js';

test('复盘只在已结束且有揭晓授权时开放，也不读取或复制汤底', () => {
  const reveal = {}; Object.defineProperty(reveal, 'truth', { get() { throw new Error('must not read truth'); } });
  const ended = { status: 'won', reveal, log: [] };
  assert.equal(buildReview({ ...ended, status: 'playing' }), null);
  assert.equal(buildReview({ ...ended, status: 'loading' }), null);
  assert.equal(buildReview({ ...ended, reveal: null }), null);
  assert.equal(buildReview(ended).firstBreak, null);
});

test('否定回答也能构成突破；未知与无效不增加序号，有效排除不算浪费', () => {
  const review = buildReview({ status: 'won', reveal: {}, log: [
    { q: '为什么？', verdict: 'invalid', counted: false },
    { q: '具体动机有交代吗？', verdict: 'unknown', counted: false },
    { q: '他是在录音机里听到的吗？', verdict: 'no', counted: true, newClues: ['f1'] },
    { q: '她是独生女吗？', verdict: 'no', counted: true, newClues: [] },
    { q: '下面有人吗？', verdict: 'yes', counted: true, newClues: ['f2', 'f3'] },
    { q: '那里有活人吗？', verdict: 'yes', counted: true, reClues: ['f2'], newClues: [] },
  ] });
  assert.deepEqual(review.firstBreak, { q: '他是在录音机里听到的吗？', no: 1, ids: ['f1'], label: '否' });
  assert.deepEqual(review.breakthroughs.map((b) => [b.no, b.count, b.label]), [[1, 1, '否'], [3, 2, '是']]);
  assert.equal(review.exclusions[1].q, '她是独生女吗？');
  assert.equal(review.exclusions[1].label, '否');
  assert.deepEqual(review.stats, { invalid: 1, unknown: 1, repeatedFact: 1 });
  assert.ok(!review.summary.includes('浪费') && !review.summary.includes('错误'));
});

test('复盘记录去重且限制三条，重新确认同时有新线索时不算重复确认', () => {
  const log = Array.from({ length: 5 }, (_, i) => ({ q: `假设${i}成立吗？`, verdict: 'no', counted: true, newClues: [`f${i}`], reClues: i ? ['f0'] : [] }));
  log.push({ ...log[0], q: '假设0 成立吗', newClues: [], reClues: [] });
  const review = buildReview({ status: 'gaveup', reveal: {}, log });
  assert.equal(review.breakthroughs.length, 3);
  assert.equal(review.exclusions.length, 3);
  assert.equal(review.stats.repeatedFact, 0);
  assert.ok(review.summary.includes('5 项关键事实') && review.summary.includes('5 条排除记录'));
});

const cases = [
  { id: 'rainy-elevator', difficulty: 2 }, { id: 'second-cake', difficulty: 3 },
  { id: 'after-curtain', difficulty: 3 }, { id: 'blind-meal', difficulty: 2 },
  { id: 'easy-case', difficulty: 1 }, { id: 'perfect-crime', difficulty: 3, collection: 'archive' },
];
test('轻松完成后逐步提高难度，并优先衔接精选案件', () => {
  const current = { puzzle: cases[0], status: 'won', stats: { used: 12, hints: 0 } };
  const result = recommendNext(cases, current, { 'rainy-elevator': 'won' });
  assert.equal(result.puzzle.id, 'second-cake');
  assert.ok(result.reason.includes('更高难度'));
});
test('揭晓、失败或使用多个提示后优先降低难度；没有低难题则选同难度', () => {
  for (const [status, hints] of [['gaveup', 0], ['lost', 0], ['won', 2]]) {
    const st = { puzzle: cases[1], status, stats: { used: 20, hints } };
    assert.equal(recommendNext(cases, st).puzzle.id, 'rainy-elevator');
    const sameOnly = [cases[1], cases[2], cases[5]];
    assert.equal(recommendNext(sameOnly, st).puzzle.id, 'after-curtain');
  }
});
test('推荐排除已玩、归档和当前案件；全部玩完返回null，同分结果确定', () => {
  const st = { puzzle: cases[0], status: 'won', stats: { used: 30, hints: 1 } };
  const played = Object.fromEntries(cases.map((p) => [p.id, 'won']));
  assert.equal(recommendNext(cases, st, played), null);
  assert.equal(recommendNext(cases, st, new Set(cases.map((p) => p.id))), null);
  const ties = [{ id: 'z', difficulty: 2 }, { id: 'a', difficulty: 2 }];
  assert.equal(recommendNext(ties, st).puzzle.id, 'a');
  assert.equal(recommendNext([...ties].reverse(), st).puzzle.id, 'a');
  assert.equal(recommendNext([cases[0], cases[5]], st), null);
  assert.equal(recommendNext([{ id: 'warm-story', difficulty: 2, collection: 'warm' }], st), null);
});
