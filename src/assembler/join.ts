/**
 * The deterministic join (ADR 0008 decision 4) — "a join, not a judgement".
 *
 * "Present" means named in `characters_present`, full stop. Not also implied by the previous
 * scene's `closing_situation`, which is freeform prose and would make presence non-deterministic;
 * and never inferred from prose at all, because there is no `lookup(entity)` tool in the writer
 * call to correct a bad guess with (function calling ends the turn, per the Gemini research §4).
 *
 * What the join misses is not silently lost: the writer reports a `missing_fact` diagnostic when
 * it needed something it wasn't given (ADR 0008 decision 5), which is what closes the loop the
 * no-tools decision opened.
 */

import type {
  Character,
  CharacterKnowledge,
  Relationship,
  SceneCard,
  StoryLocation,
  StoryObject,
} from '../schema/story-package';
import type { WorldModel } from '../world-model/world-model';

/** The relationship kind that puts an object in a character's hands rather than in a room. */
export const POSSESSES = 'possesses';

export interface JoinedRows {
  readonly characters: Character[];
  readonly location: StoryLocation | null;
  readonly objects: StoryObject[];
  /** Relationships with both endpoints present — the tightest, highest-priority group. */
  readonly relationships_both_present: Relationship[];
  /** Relationships touching exactly one present entity. */
  readonly relationships_one_present: Relationship[];
  /** `character_knowledge` rows for present characters, tied to this scene's own facts. */
  readonly knowledge_scene_facts: CharacterKnowledge[];
  /** Every other `character_knowledge` row for a present character — broader epistemic context. */
  readonly knowledge_other: CharacterKnowledge[];
}

/** Every entity id the join treats as on stage: present characters, the location, objects. */
export function presentEntityIds(rows: JoinedRows): string[] {
  return [
    ...rows.characters.map((row) => row.id),
    ...(rows.location === null ? [] : [rows.location.id]),
    ...rows.objects.map((row) => row.id),
  ];
}

/** The fact-refs a Scene Card names in its own right — its invariant and obligation surface. */
export function sceneFactRefs(scene: SceneCard): Set<string> {
  return new Set<string>([
    ...scene.reader_must_learn,
    ...scene.must_stay_hidden,
    ...scene.pays_off.map((payoff) => payoff.fact_ref),
  ]);
}

export function joinSceneRows(scene: SceneCard, model: WorldModel): JoinedRows {
  const presentCharacterIds = new Set(scene.characters_present);

  const characters = scene.characters_present
    .map((id) => model.row(id))
    .filter((row): row is Character => row !== null && model.tableOf(row.id) === 'character');

  const locationRow = model.row(scene.location_id);
  const location =
    locationRow !== null && model.tableOf(scene.location_id) === 'location'
      ? (locationRow as StoryLocation)
      : null;

  // Objects in scope: sitting in the scene's location, or held by a present character. Both are
  // physical facts, and they are distinct — `location_id` is where a thing sits, a `possesses`
  // edge is who has it (an object in a pocket has no room).
  const heldIds = new Set<string>();
  for (const edge of model.rows('relationship')) {
    if (edge.kind === POSSESSES && presentCharacterIds.has(edge.from_id)) {
      heldIds.add(edge.to_id);
    }
  }
  const objects = model
    .rows('object')
    .filter((row) => row.location_id === scene.location_id || heldIds.has(row.id));

  const onStage = new Set<string>([
    ...presentCharacterIds,
    ...(location === null ? [] : [location.id]),
    ...objects.map((row) => row.id),
  ]);

  const bothPresent: Relationship[] = [];
  const onePresent: Relationship[] = [];
  for (const edge of model.rows('relationship')) {
    const from = onStage.has(edge.from_id);
    const to = onStage.has(edge.to_id);
    if (from && to) bothPresent.push(edge);
    else if (from || to) onePresent.push(edge);
  }

  const facts = sceneFactRefs(scene);
  const sceneFacts: CharacterKnowledge[] = [];
  const otherFacts: CharacterKnowledge[] = [];
  for (const row of model.rows('character_knowledge')) {
    if (!presentCharacterIds.has(row.character_id)) continue;
    if (facts.has(row.fact_ref)) sceneFacts.push(row);
    else otherFacts.push(row);
  }

  return {
    characters,
    location,
    objects,
    relationships_both_present: bothPresent,
    relationships_one_present: onePresent,
    knowledge_scene_facts: sceneFacts,
    knowledge_other: otherFacts,
  };
}

/**
 * Characters with an on-page beat but no World Model row, because they are absent from
 * `characters_present`.
 *
 * The join is deterministic off declared fields only, so it will not surface such a character —
 * the Cinderella fixture's godmother in `scene_13_the_fitting` is the worked example ADR 0012's
 * prototype flagged. That is an authoring gap, not a bug in the join, and the fixture is not this
 * ticket's to edit; surfacing it here means the compiler can log it instead of the writer having
 * to notice, and it is exactly what a `missing_fact` would otherwise report after the fact.
 */
export function beatOnlyCharacters(scene: SceneCard, model: WorldModel): Character[] {
  const present = new Set(scene.characters_present);
  const beatText = [...scene.required_beats, scene.dramatic_function].join(' ').toLowerCase();
  return model
    .rows('character')
    .filter((row) => !present.has(row.id))
    .filter((row) => row.name.length > 2 && beatText.includes(row.name.toLowerCase()));
}
