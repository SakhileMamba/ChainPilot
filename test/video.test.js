// The video tutorial's storyboard: checks that would otherwise only fail ten minutes
// into a render. (The render itself needs Chrome and ffmpeg: npm run video.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSummary } from '../src/compounding.js';
import { chainScene, edgeScene, EXAMPLE, oddsScene } from '../tools/video/scenes.js';
import { seededRandom } from '../tools/video/sim.js';
import { CHAPTERS, STORYBOARD } from '../tools/video/storyboard.js';

test('scene ids are unique and safe as voice file names', () => {
  const ids = STORYBOARD.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^\d{2}-[a-z0-9-]+$/);
});

test('every narration cue exists in its scene, and every chapter is used', () => {
  for (const scene of STORYBOARD) {
    assert.ok(scene.say.length > 20, scene.id);
    for (const [, , phrase] of scene.run.toString().matchAll(/cue\((['"`])(.+?)\1\)/g)) {
      assert.ok(scene.say.includes(phrase), `${scene.id}: cue "${phrase}" is not in its narration`);
    }
  }
  const used = new Set(STORYBOARD.map((s) => s.chapter));
  for (const chapter of CHAPTERS) assert.ok(used.has(chapter), `chapter "${chapter}" has no scenes`);
});

test('concept scenes show the real numbers', () => {
  const s = planSummary(EXAMPLE);
  assert.match(chainScene(), /247\.60/);
  assert.match(chainScene(), /\+237\.60 profit/);
  assert.match(oddsScene(), new RegExp(`${(s.chainChance * 100).toFixed(1)}%`));
  assert.match(oddsScene(), /1 chain in 29/);
  assert.match(edgeScene(), new RegExp(`${Math.round(s.avgReturn * 100)}%`));
});

test('the simulated rounds are reproducible', () => {
  const a = seededRandom(1);
  const b = seededRandom(1);
  const first = Array.from({ length: 5 }, a);
  assert.deepEqual(first, Array.from({ length: 5 }, b));
  assert.ok(first.every((x) => x >= 0 && x < 1));
});
