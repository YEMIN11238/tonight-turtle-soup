import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { atmosphereArt, atmosphereStage } from '../public/case-atmosphere.js';

test('stage art never reveals an ended scene for a playing or unknown case', () => {
  const playing = { puzzle: { id: 'second-cake' }, status: 'playing' };
  assert.equal(atmosphereStage(playing), 'quiet');
  assert.equal(atmosphereStage({ ...playing, sceneStage: 'revealed' }), 'quiet');
  assert.equal(atmosphereStage({ ...playing, sceneStage: '__proto__' }), 'quiet');
  assert.equal(atmosphereArt({ ...playing, puzzle: { id: 'blind-meal' }, sceneStage: 'locked' }), null);
  assert.equal(atmosphereArt(playing).title, '');
  assert.equal(atmosphereArt({ ...playing, sceneStage: 'presence' }).detail.includes('无法自由离开'), false);
  assert.equal(atmosphereStage({ ...playing, status: 'won', sceneStage: 'revealed' }), 'revealed');
});

test('all shipped stage assets are real WebP images, with distinct closed, locked and revealed scenes', async () => {
  const scenes = ['quiet', 'locked', 'revealed'].map((sceneStage) => atmosphereArt({
    puzzle: { id: 'second-cake' }, status: sceneStage === 'revealed' ? 'gaveup' : 'playing', sceneStage,
  }));
  assert.equal(new Set(scenes.map((art) => art.src)).size, 3);
  for (const art of scenes) {
    const bytes = await readFile(new URL(`../public/${art.src}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length > 10_000 && bytes.length < 200_000);
  }
});

test('each flagship accepts only its own confirmed stages and requires an ended status for reveal', () => {
  const definitions = {
    'second-cake': ['quiet', 'presence', 'locked', 'revealed'],
    'rainy-elevator': ['quiet', 'watched', 'followed', 'revealed'],
    'after-curtain': ['quiet', 'unpowered', 'below', 'revealed'],
  };
  for (const [id, stages] of Object.entries(definitions)) {
    const st = { puzzle: { id }, status: 'playing' };
    assert.equal(atmosphereStage(st), 'quiet');
    for (const stage of stages.filter((s) => s !== 'revealed')) assert.equal(atmosphereStage({ ...st, sceneStage: stage }), stage);
    for (const status of ['playing', undefined, 'loading']) assert.equal(atmosphereStage({ ...st, status, sceneStage: 'revealed' }), 'quiet');
    for (const status of ['won', 'lost', 'gaveup']) assert.equal(atmosphereStage({ ...st, status, sceneStage: 'revealed' }), 'revealed');
    const foreignStage = Object.values(definitions).flat().find((s) => !stages.includes(s));
    assert.equal(atmosphereStage({ ...st, sceneStage: foreignStage }), 'quiet');
    assert.equal(atmosphereStage({ ...st, sceneStage: '__proto__' }), 'quiet');
  }
  const elevatorEarly = atmosphereArt({ puzzle: { id: 'rainy-elevator' }, status: 'playing', sceneStage: 'watched' });
  assert.ok(!elevatorEarly.detail.includes('尾随'));
  const theaterEarly = atmosphereArt({ puzzle: { id: 'after-curtain' }, status: 'playing', sceneStage: 'unpowered' });
  assert.ok(!theaterEarly.detail.includes('活人') && !theaterEarly.detail.includes('求救'));
});

test('both new flagship scenes ship real stage pictures with distinct initial and discovery artwork', async () => {
  for (const [id, stages] of [['rainy-elevator', ['quiet', 'watched', 'revealed']], ['after-curtain', ['quiet', 'unpowered', 'below']]]) {
    const sources = stages.map((sceneStage) => atmosphereArt({ puzzle: { id }, status: sceneStage === 'revealed' ? 'gaveup' : 'playing', sceneStage }).src);
    assert.equal(new Set(sources).size, 3);
    for (const src of sources) {
      const bytes = await readFile(new URL(`../public/${src}`, import.meta.url));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      assert.ok(bytes.length > 10_000 && bytes.length < 200_000);
    }
  }
});
