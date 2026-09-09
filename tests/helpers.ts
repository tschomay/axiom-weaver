import { WorldModel } from '@/world-model/world-model';
import { SceneCardSchema, WorldModelSeedSchema, type SceneCard } from '@/schema/story-package';

/**
 * A miniature world for validator tests: the ADR 0005 worked example (Jim walks to the park)
 * plus what the other rules need — an entity outside the footprint, and a volitional column.
 */
export function jimsWorld(): WorldModel {
  return WorldModel.fromSeed(
    'jim',
    WorldModelSeedSchema.parse({
      characters: [
        {
          id: 'char_jim',
          name: 'Jim',
          location_id: 'loc_home',
          status: 'alive',
          goal: 'keep his head down',
        },
        { id: 'char_ada', name: 'Ada', location_id: 'loc_office', status: 'alive' },
      ],
      locations: [
        { id: 'loc_home', name: 'home' },
        { id: 'loc_park', name: 'the park' },
        { id: 'loc_office', name: 'the office' },
      ],
      objects: [
        { id: 'obj_umbrella', name: 'an umbrella', location_id: 'loc_home', status: 'intact' },
      ],
      relationships: [
        {
          id: 'rel_001',
          from_id: 'char_ada',
          to_id: 'char_jim',
          kind: 'employer_of',
          sentiment: 'trusts',
        },
      ],
    }),
  );
}

export function scene(overrides: Partial<SceneCard> = {}): SceneCard {
  return SceneCardSchema.parse({
    id: 'scene_01_the_walk',
    order: 1,
    pov: 'char_jim',
    location_id: 'loc_home',
    characters_present: ['char_jim'],
    dramatic_function: 'Jim walks to the park.',
    entry_state: { char_jim: { location_id: 'loc_home' } },
    exit_state: { char_jim: { location_id: 'loc_park' } },
    required_beats: ['Jim walks to the park'],
    ...overrides,
  });
}
