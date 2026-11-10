import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPuzzle, validatePuzzle } from '../server/puzzles.js';
import * as G from '../server/game.js';

const ids = ['second-cake', 'rainy-elevator', 'after-curtain'];
const answer = (s, p, q, matched, verdict = 'yes') => G.applyAsk(s, p, q, G.sanitizeJudge({ verdict, matched_fact_ids: matched }, p));

test('三宗精选案事实权重完整，任何核心事实缺失都不能借旧线索结案', () => {
  for (const id of ids) {
    const p = getPuzzle(id), all = p.facts.map((f) => f.id);
    assert.deepEqual(validatePuzzle(p), [], id);
    assert.equal(G.scoreSubmission(p, all).score, 100, id);
    assert.equal(G.scoreSubmission(p, all).passed, true, id);
    for (const core of p.facts.filter((f) => f.core)) {
      assert.equal(G.scoreSubmission(p, all.filter((x) => x !== core.id), [], all).passed, false, `${id}:${core.id}`);
    }
  }
});

test('电梯中核实实际楼层，不会自动确认男人提前知情或尾随', () => {
  const p = getPuzzle('rainy-elevator'), s = G.newSession(p), q = '她实际住十二楼吗？';
  assert.equal(G.publicState(s, p).sceneStage, 'quiet');
  const entry = answer(s, p, q, ['f3', 'f4', 'f7']);
  assert.deepEqual(entry.newClues, ['f7']);
  const st = G.publicState(s, p);
  assert.equal(st.sceneStage, 'quiet');
  assert.equal(st.progress, 10);
  assert.equal(st.clues[0].card, q);
  assert.ok(!JSON.stringify(st).includes('尾随'));
  assert.ok(!JSON.stringify(st).includes('跟踪'));
});

test('电梯的知情、尾随是两个独立发现；改写同义问题也能推进', () => {
  const p = getPuzzle('rainy-elevator'), s = G.newSession(p);
  answer(s, p, '男人在问她之前就知道她真正住哪一层了吗？', ['f3', 'f4']);
  assert.deepEqual(s.unlocked, ['f3']);
  assert.equal(G.publicState(s, p).sceneStage, 'watched');
  assert.ok(!JSON.stringify(G.publicState(s, p)).includes('尾随'));
  answer(s, p, '他以前跟着她回过这栋楼吗？', ['f4']);
  assert.equal(G.publicState(s, p).sceneStage, 'followed');
  assert.equal(G.publicState(s, p).progress, 45);
});

test('电梯旧会话中的合并事实，不能从试探问句推定此前尾随', () => {
  const p = getPuzzle('rainy-elevator'), s = G.newSession(p);
  s.unlocked = ['f3', 'f4'];
  s.unlockedBy = { f3: '他按下了十二楼吗？', f4: '他问楼层是在试探她吗？' };
  assert.equal(G.publicState(s, p).sceneStage, 'quiet');
});

test('确认断电与声源无关，只改变设备阶段，不自动揭露舞台下的活人', () => {
  const p = getPuzzle('after-curtain'), s = G.newSession(p), q = '掌声不来自已经关闭的录音设备吗？';
  const entry = answer(s, p, q, ['f1', 'f3']);
  assert.deepEqual(entry.newClues, ['f1']);
  const st = G.publicState(s, p);
  assert.equal(st.sceneStage, 'unpowered');
  assert.equal(st.progress, 10);
  assert.equal(st.clues[0].card, q);
  for (const hidden of ['活人', '囚禁', '失踪者', '无法发声', '求救']) assert.ok(!JSON.stringify(st).includes(hidden), hidden);
});

test('舞台下有人是独立发现，不会顺带赠送发声障碍或求救方式', () => {
  const p = getPuzzle('after-curtain'), s = G.newSession(p), q = '舞台下面有一个活人吗？';
  answer(s, p, q, ['f3']);
  const st = G.publicState(s, p);
  assert.equal(st.sceneStage, 'below');
  assert.equal(st.progress, 15);
  assert.equal(st.clues.length, 1);
  assert.equal(st.clues[0].card, q);
  for (const hidden of ['无法发声', '求救', 'SOS', '囚禁者']) assert.ok(!JSON.stringify(st).includes(hidden), hidden);
});

test('含糊人声问句与旧版失声问句，不能直接触发舞台下活人的画面', () => {
  const p = getPuzzle('after-curtain'), s = G.newSession(p);
  answer(s, p, '那个声音是活人发出的吗？', ['f3']);
  assert.equal(G.publicState(s, p).sceneStage, 'quiet');
  s.unlocked = ['f3']; s.unlockedBy.f3 = '他是不是不能说话？';
  assert.equal(G.publicState(s, p).sceneStage, 'quiet');
});

test('未提供白名单逻辑确认的否定与未交代不触发演出；仅结案后展示揭晓场景', () => {
  for (const id of ids) {
    const p = getPuzzle(id), s = G.newSession(p);
    answer(s, p, '这件事和我猜的一样吗？', p.facts.map((f) => f.id), 'no');
    answer(s, p, '故事后来是否发生了另一件事？', p.facts.map((f) => f.id), 'unknown');
    assert.equal(G.publicState(s, p).sceneStage, 'quiet', id);
    assert.equal(G.remaining(s), 39, id);
    for (const status of ['won', 'lost', 'gaveup']) {
      s.status = status;
      assert.equal(G.publicState(s, p).sceneStage, 'revealed', `${id}:${status}`);
    }
  }
});

test('排除十八楼即使模型误报十二楼，也不能解锁或抢先收录实际住处', () => {
  const p = getPuzzle('rainy-elevator'), s = G.newSession(p), q = '她真的住在十八楼吗？';
  const judged = G.sanitizeJudge({ verdict: 'no', matched_fact_ids: ['f7'], confirmed_fact_ids: ['f7', 'f3', 'f4'] }, p);
  assert.deepEqual(judged.matched, []);
  G.applyAsk(s, p, q, judged);
  assert.deepEqual(s.unlocked, []);
  assert.equal(G.publicState(s, p).progress, 0);
  assert.equal(G.publicState(s, p).sceneStage, 'quiet');
  assert.equal(G.publicState(s, p).exclusions[0].label, '否');
  // 即使内部调用者跳过 sanitize，也不能把正向事实由 no 写入对局。
  const direct = G.newSession(p);
  G.applyAsk(direct, p, q, { verdict: 'no', matched: ['f7', 'f3', 'f4'], reason: '' });
  assert.deepEqual(direct.unlocked, []);
  // 后续真正问中十二楼时，仍应是首次收录，不能误算重复线索。
  const entry = answer(s, p, '她实际住在十二楼吗？', ['f7']);
  assert.deepEqual(entry.newClues, ['f7']);
  assert.deepEqual(entry.reClues, []);
  assert.equal(G.publicState(s, p).clues[0].label, '是');
});

test('no白名单由sanitize与apply双层限制；yes确认仍覆盖所有合法事实', () => {
  for (const id of ids) {
    const p = getPuzzle(id), all = p.facts.map((f) => f.id);
    const judged = G.sanitizeJudge({ verdict: 'no', confirmed_fact_ids: all, matched_fact_ids: all }, p);
    assert.deepEqual(judged.matched, p.facts.filter((f) => f.confirm_on_no === true).map((f) => f.id), id);
    const s = G.newSession(p);
    G.applyAsk(s, p, p.facts.map((f) => f.text).join('，'), { verdict: 'no', matched: all, reason: '' });
    assert.ok(s.unlocked.every((fid) => p.facts.find((f) => f.id === fid)?.confirm_on_no === true), id);
    assert.deepEqual(G.sanitizeJudge({ verdict: 'yes', confirmed_fact_ids: all, matched_fact_ids: [] }, p).matched, all, id);
  }
});

test('自然no仅通过显式逻辑确认解锁录音排除事实，保留真实回答且不附送活人', () => {
  const p = getPuzzle('after-curtain'), s = G.newSession(p), q = '这些掌声是录音吗？';
  const judged = G.sanitizeJudge({ verdict: 'no', matched_fact_ids: ['f3', 'f4', 'f5'], confirmed_fact_ids: ['f1'] }, p);
  const entry = G.applyAsk(s, p, q, judged);
  assert.deepEqual(entry.newClues, ['f1']);
  assert.equal(entry.newExclusion, true);
  const st = G.publicState(s, p);
  assert.equal(st.sceneStage, 'unpowered');
  assert.equal(st.progress, 10);
  assert.equal(st.clues[0].card, q);
  assert.equal(st.clues[0].label, '否');
  assert.equal(st.exclusions[0].q, q);
  assert.equal(st.log[0].label, '否');
  for (const hidden of ['活人', '囚禁', '失踪者', '无法发声', '求救']) assert.ok(!JSON.stringify(st).includes(hidden), hidden);
});

test('否定与双重否定问句的线索保留模型确认后的原始yes/no，不由关键词翻转', () => {
  const p = getPuzzle('after-curtain');
  for (const [q, verdict, label] of [
    ['这些掌声不是录音吗？', 'yes', '是'],
    ['这些掌声并不是没有来自录音，对吗？', 'no', '否'],
  ]) {
    const s = G.newSession(p);
    G.applyAsk(s, p, q, G.sanitizeJudge({ verdict, matched_fact_ids: [], confirmed_fact_ids: ['f1'] }, p));
    const st = G.publicState(s, p);
    assert.equal(st.sceneStage, 'unpowered');
    assert.equal(st.clues[0].card, q);
    assert.equal(st.clues[0].label, label);
    assert.deepEqual(s.unlocked, ['f1']);
  }
});

test('排除死人或未知后续不推定活人；未交代和无效题即使带确认字段也永不解锁', () => {
  const p = getPuzzle('after-curtain'), all = p.facts.map((f) => f.id);
  const s = G.newSession(p);
  G.applyAsk(s, p, '舞台下有死人吗？', G.sanitizeJudge({ verdict: 'no', matched_fact_ids: ['f3'], confirmed_fact_ids: [] }, p));
  assert.deepEqual(s.unlocked, []);
  assert.equal(G.publicState(s, p).sceneStage, 'quiet');
  for (const verdict of ['unknown', 'invalid', 'irrelevant']) {
    G.applyAsk(s, p, '舞台下面有人在向外求救吗？', G.sanitizeJudge({ verdict, matched_fact_ids: all, confirmed_fact_ids: all }, p));
    assert.deepEqual(s.unlocked, []);
  }
});
