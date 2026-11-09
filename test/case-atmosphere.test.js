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
