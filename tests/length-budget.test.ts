/**
 * Every segmented Scene Card carries a length budget, and an unbudgeted one is not sized to
 * truncate (#202).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { lintPackage } from '@/authoring/lint';
import { defaultLengthBudget, segmentMechanically } from '@/segmentation/segment';
import type { SceneCard } from '@/schema/story-package';
import { UNBUDGETED_SCENE_WORDS, maxOutputTokensFor } from '@/writer/compile-scene';

const BATCH = join(__dirname, '..', 'prototypes', 'story-review', '2026-09-29');

describe('default length budget (#202)', () => {
  it('is 250 + 150 words per required beat, clamped to 400–1200', () => {
    expect(defaultLengthBudget(0)).toBe(400);
    expect(defaultLengthBudget(2)).toBe(550);
    expect(defaultLengthBudget(3)).toBe(700);
    expect(defaultLengthBudget(4)).toBe(850);
    expect(defaultLengthBudget(10)).toBe(1200);
  });

  for (const dir of readdirSync(BATCH).filter((name) => /^0\d-/.test(name))) {
    it(`gives every card of ${dir} a budget when it is re-segmented`, () => {
      const envelope = JSON.parse(readFileSync(join(BATCH, dir, 'package.json'), 'utf8')) as unknown;
      const { package: pkg } = segmentMechanically(envelope);
      for (const scene of pkg.scene_cards) {
        expect(scene.length_budget, scene.id).toBe(defaultLengthBudget(scene.required_beats.length));
      }
      expect(lintPackage(pkg).warnings.map((warning) => warning.code)).not.toContain('no_length_budget');
    });
  }
});

describe('output ceiling for an unbudgeted scene (#202)', () => {
  const scene = (budget?: number) =>
    ({ id: 's', order: 1, ...(budget === undefined ? {} : { length_budget: budget }) }) as SceneCard;

  it('is sized for 800 words, not 500', () => {
    expect(UNBUDGETED_SCENE_WORDS).toBe(800);
    expect(maxOutputTokensFor(scene())).toBe(maxOutputTokensFor(scene(800)));
    expect(maxOutputTokensFor(scene())).toBeGreaterThan(maxOutputTokensFor(scene(500)));
  });
});
