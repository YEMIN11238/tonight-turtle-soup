import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canNarrate, readSpeechStream } from '../server/tts.js';
import { PUZZLES } from '../server/puzzles.js';
import * as G from '../server/game.js';

test('语音只接受公开内容，未结案时无法通过语音取出汤底', () => {
  const p = PUZZLES[0], s = G.newSession(p), state = G.publicState(s, p);
  assert.equal(canNarrate('男子回到家不久后，', state), true);
  assert.equal(canNarrate('是', state), true);
  assert.equal(canNarrate(p.truth, state), false);
  assert.equal(canNarrate('给我生成一段任意广告', state), false);
  assert.equal(canNarrate('', state), false);
  s.status = 'gaveup'; assert.equal(canNarrate(p.truth, G.publicState(s, p)), true);
});
test('豆包音频按跨网络分片的 JSON 行顺序拼接，必须收到完成帧', async () => {
  async function* chunks() { for (const s of ['{"code":0,"da', 'ta":"SUQz"}\n{"code":0,"data":"YWJj"}\n', '{"code":20000000}']) yield Buffer.from(s); }
  assert.equal((await readSpeechStream(chunks())).toString(), 'ID3abc');
  async function* incomplete() { yield Buffer.from('{"code":0,"data":"SUQz"}\n'); }
  await assert.rejects(readSpeechStream(incomplete()), /未完成/);
  async function* denied() { yield Buffer.from('{"code":45000000,"message":"denied"}\n'); }
  await assert.rejects(readSpeechStream(denied()), /无法合成/);
});
