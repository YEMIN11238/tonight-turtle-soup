import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingParts } from '../public/opening-flow.js';
import { saveRecord, challengeText } from '../public/case-records.js';
test('开场保留汤面原文且不把同一句切成多个停顿页', () => {
  const surface = '她一直以为自己是独生女。每年生日，父亲都会买两个同款蛋糕，把第二个送进地下室。父亲住院后，她第一次代送，出来后再也不敢叫他爸爸。';
  const parts = openingParts(surface);
  assert.equal(parts.join(''), surface);
  assert.ok(parts.length <= 3);
});
test('结案重复渲染不增加场次，揭晓不覆盖最佳成功纪录，分享不含答案', () => {
  const data = new Map(), storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const st = { sid: 'a', puzzle: { id: 'sample', title: '暗门' }, status: 'won', stats: { used: 12, hints: 0, score: 100 }, reveal: { truth: '秘密答案' }, log: [{ q: '私密问题' }] };
  saveRecord(storage, st);
  assert.equal(saveRecord(storage, st).completed, 1);
  const after = saveRecord(storage, { ...st, sid: 'b', status: 'gaveup', stats: { used: 0, hints: 0, score: null } });
  assert.equal(after.best.used, 12);
  assert.equal(after.completed, 2);
  assert.ok(!JSON.stringify([...data.values()]).includes('秘密答案'));
  assert.ok(!challengeText(st).includes('私密问题'));
  assert.ok(challengeText(st).includes('12 问'));
});
