import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES, getPuzzle } from '../server/puzzles.js';
import * as G from '../server/game.js';

const cake = getPuzzle('second-cake');

test('确认活人不会顺带透露囚禁；宽泛问题不能误触发危险演出', () => {
  const s = G.newSession(cake), q = '地下室里住着一个活人吗？';
  assert.equal(G.publicState(s, cake).sceneStage, 'quiet');
  // 模拟模型过宽命中旧的囚禁事实，公开输出和阶段都必须守住边界。
  const entry = G.applyAsk(s, cake, q, G.sanitizeJudge({ verdict: 'yes', matched_fact_ids: ['f3', 'f6'] }, cake));
  assert.deepEqual(entry.newClues, ['f6']);
  const st = G.publicState(s, cake);
  assert.equal(st.sceneStage, 'presence');
  assert.equal(st.progress, 10);
  assert.equal(st.clues[0].card, q);
  assert.equal(st.clues[0].label, '是');
  for (const hidden of ['无法自由离开', '不能自由离开', '囚禁', '双胞胎姐姐']) assert.ok(!JSON.stringify(st).includes(hidden), hidden);
});

test('所有题的线索卡只展示实际问题，不扩写预制汤底文案', () => {
  for (const p of PUZZLES) {
    const s = G.newSession(p), q = '这是一条玩家实际提出的问题吗？';
    G.applyAsk(s, p, q, { verdict: 'yes', matched: p.facts.map((f) => f.id), reason: '' });
    for (const clue of G.publicState(s, p).clues) {
      assert.equal(clue.card, q, p.id);
      assert.equal(clue.source, 'question', p.id);
      assert.equal(clue.label, '是', p.id);
    }
  }
});

test('危险阶段必须确认囚禁，揭晓阶段只随结案开放', () => {
  const s = G.newSession(cake);
  G.applyAsk(s, cake, '地下室里的人不能自由离开吗？', { verdict: 'yes', matched: ['f3'], reason: '' });
  assert.equal(G.publicState(s, cake).sceneStage, 'locked');
  G.applyAsk(s, cake, '里面的人是她的双胞胎姐姐吗？', { verdict: 'yes', matched: ['f2'], reason: '' });
  assert.equal(G.publicState(s, cake).sceneStage, 'locked');
  for (const status of ['won', 'gaveup', 'lost']) {
    s.status = status;
    assert.equal(G.publicState(s, cake).sceneStage, 'revealed');
  }
  assert.equal(G.publicState(G.newSession(PUZZLES[0]), PUZZLES[0]).sceneStage, undefined);
});

test('旧局宽泛问题曾错误解锁囚禁时，也不能据此播放新演出', () => {
  const s = G.newSession(cake);
  s.unlocked = ['f3'];
  s.unlockedBy.f3 = '地下室里住着一个活人吗？';
  assert.equal(G.publicState(s, cake).sceneStage, 'quiet');
});

test('排除记录保留问句逻辑、玩家和序号，不重复收录', () => {
  const s = G.newSession(cake), q = '地下室里不是活人吗？';
  const first = G.applyAsk(s, cake, q, { verdict: 'no', matched: [], reason: '' }, '乙');
  assert.equal(first.newExclusion, true);
  const repeated = G.applyAsk(s, cake, '地下室里 不是活人吗', { verdict: 'no', matched: [], reason: '' }, '甲');
  assert.equal(repeated.newExclusion, false);
  const st = G.publicState(s, cake);
  assert.deepEqual(st.exclusions, [{ id: 'excluded-1', q, card: q, label: '否', no: 1, by: '乙' }]);
  assert.equal(st.progress, 0, '排除记录不冒充已命中的核心事实');
  assert.equal(st.clues.length, 0);
});

test('未交代和无效提问均不扣次数；重复未知问题复用判定', () => {
  const s = G.newSession(cake);
  G.applyAsk(s, cake, '父亲为什么囚禁她？', { verdict: 'invalid', matched: [], reason: '' });
  G.applyAsk(s, cake, '父亲这样做是为了钱吗？', { verdict: 'unknown', matched: [], reason: '故事里没有交代' });
  assert.equal(G.remaining(s), G.MAX_Q);
  assert.equal(G.findDuplicate(s, '父亲这样做是为了钱吗')?.verdict, 'unknown');
  assert.equal(G.findDuplicate(s, '父亲为什么囚禁她'), undefined);
  G.applyAsk(s, cake, '地下室里有人吗？', { verdict: 'yes', matched: ['f6'], reason: '' });
  assert.equal(G.publicState(s, cake).clues[0].no, 1);
});

test('模型的自由理由不会越过未知和无效的提示边界', () => {
  assert.equal(G.sanitizeJudge({ verdict: 'unknown', reason: '不过门的外面有一把锁' }, cake).reason, '故事里没有交代');
  assert.equal(G.sanitizeJudge({ verdict: 'invalid', reason: '你应该先问她的身世' }, cake).reason, '请换成能用“是/否”回答的单个问题');
  assert.equal(G.sanitizeJudge({ verdict: 'invalid', reason: '请一次只问一件事' }, cake).reason, '请一次只问一件事');
});

test('未结案提交得到的事实不借预制卡片继续补充答案', () => {
  const s = G.newSession(cake);
  s.unlocked = ['f2'];
  s.unlockedBy.f2 = '（推理中说出）';
  const st = G.publicState(s, cake);
  assert.equal(st.clues[0].source, 'submission');
  assert.equal(st.clues[0].card, '这项事实已在你的推理中确认。');
  assert.ok(!JSON.stringify(st).includes('双胞胎'));
});

test('第二个蛋糕初始引导不预设地下室有人；悲情旧案移入旧卷', () => {
  const st = G.publicState(G.newSession(cake), cake);
  assert.ok(st.nudges.every((n) => !/地下室里的人|姐姐|双胞胎|囚禁/.test(n)));
  assert.equal(getPuzzle('glass-of-water').title, '最后一杯水');
  assert.equal(getPuzzle('perfect-crime').collection, 'archive');
});
