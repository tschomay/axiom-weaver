/**
 * The generation prompt and its response schema — one interleaved pass.
 *
 * `docs/research/llm-arc-generation-prior-art.md` §6 settles the shape and this module does not
 * relitigate it: the World Model seed, the chronological event list **and its `pays_off` edges**
 * come back in a single structured response, with every payoff naming its plant live. There is no
 * second call that reads the event list and decides where things were planted. That call is the
 * option §6 rejects on three independent grounds — it reinstates the guess ADR 0004 decision 2
 * forbids, it puts post-hoc structural-defect detection (the weakest measured capability in this
 * space) in the critical path, and it is intrinsic self-correction with no external signal.
 *
 * Two ordering choices inside the one response, both load-bearing:
 *
 * 1. **Seed before events.** Events reference entity ids, so the seed has to exist first; and §2's
 *    fixation finding says whatever is emitted first dominates, which is an argument for the thing
 *    emitted first being a *world* rather than an abstract dependency lattice (§6 option (a),
 *    rejected).
 * 2. **`pays_off` last within each event.** By the time the model writes an event's payoff edge it
 *    has already written that event's beats and reveals, so the edge is attached to something
 *    concrete rather than the beats being bent to fit a pre-declared edge.
 *
 * The schema is billed as input on every call and is not cacheable
 * (`docs/research/gemini-capabilities.md` §1), so it is kept lean deliberately — the descriptions
 * that survive are the ones that were doing work.
 */

import type { ArcBrief } from './brief';
import { EVENT_STATE_COLUMNS } from '../schema/fabula';

/** The system header: what the model is authoring, and in whose vocabulary. */
export const ARC_SYSTEM_INSTRUCTION = `You are authoring the FABULA of an original story: the world it happens in, and everything that happens in it, in CHRONOLOGICAL order.

Fabula is not narration. You are not writing prose, and you are not deciding what the reader is told first — that is a later, separate job. You are deciding what is true, in what order it happened, and what causes what.

The one hard constraint, and it is checked mechanically after you answer:

  A payoff is an event that resolves, collects or detonates something. Every payoff must name the
  EARLIER EVENT that planted it, by that event's id, in pays_off. The planting event must itself
  list the same fact_ref in its own "reveals" — the reader has to have been shown the thing, in
  that event, or it was never planted. A fact that is true from the start of the story instead
  uses plant: null, and must appear in world_model_seed.character_knowledge with
  learned_at_scene: null.

  There is no third option. A payoff you cannot honestly point a plant at is a payoff you have not
  earned; remove it, or go back and plant it properly in an earlier event.

Conversely: anything you put in an event's "reveals" is a promise. If no later event pays it off,
you have shown the reader a loaded gun and never fired it. Every fact_ref you reveal must be paid
off by some later event, or must not be revealed.

fact_ref slugs are short lower_snake_case and DESCRIBE the fact: \`loose_stair_rail\`, not \`fact_17\`. The same slug means the same fact everywhere it appears.`;

function renderPremise(brief: ArcBrief): string {
  const { premise } = brief;
  if (premise.modules === null) {
    return `PREMISE\n${premise.logline}`;
  }
  const m = premise.modules;
  return [
    'PREMISE (typed — every module is a constraint, not a suggestion)',
    `- Logline: ${premise.logline}`,
    `- Theme: ${m.theme}`,
    `- Time: ${m.setting_time}`,
    `- Place: ${m.setting_place}`,
    `- Protagonist: ${m.protagonist}`,
    `- What they want: ${m.protagonist_want}`,
    `- What opposes it: ${m.antagonism}`,
    `- The complication: ${m.complication}`,
    `- Ending shape: ${m.ending_shape}`,
  ].join('\n');
}

/**
 * How many events each phase gets.
 *
 * The allocation #119's measured prompts used — every phase at least one, the last phase taking
 * the remainder — is kept byte-for-byte wherever it works. It does not always: rounding can spend
 * the whole arc before the last phase (a 13-event mystery came out `[3,5,3,2,0]`, asking for
 * "about 0 events"), and a short arc has fewer events than phases. There the events are shared
 * out by largest remainder instead, and a phase that gets none is folded into a neighbour rather
 * than given a count the arc cannot afford.
 */
export function phaseEventCounts(shares: readonly number[], eventCount: number): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0) || 1;
  let allocated = 0;
  const counts = shares.map((share, index) => {
    const count =
      index === shares.length - 1
        ? eventCount - allocated
        : Math.max(1, Math.round((share / total) * eventCount));
    allocated += count;
    return count;
  });
  if (counts.every((count) => count >= 1)) return counts;

  const exact = shares.map((share) => (share / total) * eventCount);
  const floors = exact.map(Math.floor);
  let remaining = eventCount - floors.reduce((sum, count) => sum + count, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byRemainder) {
    if (remaining === 0) break;
    floors[index]! += 1;
    remaining -= 1;
  }
  return floors;
}

function renderPlotShape(brief: ArcBrief): string {
  const shape = brief.plot_shape;
  const counts = phaseEventCounts(
    shape.phases.map((phase) => phase.share),
    brief.event_count,
  );
  const lines = shape.phases.map((phase, index) => {
    const count = counts[index] ?? 0;
    const allotment =
      count === 0
        ? 'no event of its own — fold it into a neighbouring event'
        : `about ${count} event${count === 1 ? '' : 's'}`;
    return `  ${index + 1}. ${phase.name} — ${phase.purpose} (${allotment})`;
  });
  const shortCast = brief.cast.characters < shape.cast_roles.length;

  return [
    `PLOT SHAPE — ${shape.name}`,
    `Central question: ${shape.central_question}`,
    '',
    'Phases, in chronological order:',
    ...lines,
    '',
    ...(shortCast
      ? [
          'Cast roles this shape requires (this is a short arc with a small cast, so one character',
          'may hold more than one role):',
        ]
      : [
          'Cast roles this shape requires (give each one a real, named character; a character may hold',
          'more than one role only if that doubling is itself the point):',
        ]),
    ...shape.cast_roles.map((role) => `  - ${role.role}: ${role.purpose}`),
    '',
    'Structural obligations — these are what make this shape this shape:',
    ...shape.obligatory_moves.map((move) => `  - ${move}`),
  ].join('\n');
}

function renderPlantPolicy(brief: ArcBrief): string {
  const policy = brief.plant_policy;
  const lines = [
    'PLANT / PAYOFF GRAPH',
    `Aim for about ${policy.target_edges} plant/payoff pairs across the arc.`,
  ];
  if (brief.span_guidance) {
    lines.push(
      '',
      'Span matters more than count. A plant that lands in the event immediately before its payoff',
      'is not a plant — it is a setup sentence. What you are building is a story that reaches',
      'across itself:',
      `  - No pair should span fewer than ${policy.min_span} event${policy.min_span === 1 ? '' : 's'}.`,
      ...(policy.long_range_edges === 0
        ? []
        : [
            `  - At least ${policy.long_range_edges} pair${policy.long_range_edges === 1 ? '' : 's'} must span ${policy.long_range_span} events or more.`,
          ]),
      '  - A planting event should be doing something else at the time. The reader should register',
      '    the detail and not know it was a plant until it is collected.',
    );
  }
  return lines.join('\n');
}

export function renderArcPrompt(brief: ArcBrief): string {
  return [
    renderPremise(brief),
    '',
    renderPlotShape(brief),
    '',
    'WORLD MODEL SEED — the state of the world at the moment the story opens, and nothing later.',
    `About ${brief.cast.characters} characters, ${brief.cast.locations} locations, ${brief.cast.objects} objects.`,
    'Ids are lower_snake_case with a table prefix: char_…, loc_…, obj_…, rel_…, ck_….',
    'A character\'s `goal` is what they are trying to do as the story opens; `status` is their',
    'physical condition; `location_id` is where they are standing when it starts. Relationships are',
    'directed, with from_id and to_id both naming seeded rows.',
    'character_knowledge rows with learned_at_scene: null are facts true before the story begins —',
    'the only thing a payoff with plant: null is allowed to rest on.',
    '',
    `EVENTS — exactly ${brief.event_count} of them, sequence 1..${brief.event_count}, CHRONOLOGICAL.`,
    'Each event: what happens, where, who is there, whose experience it follows, what it makes true.',
    '  - beats: the 1–3 things that must happen in it. Never empty.',
    '  - caused_by: the earlier event ids this one follows FROM. Not merely after — caused by.',
    '    The first event has none; almost every other event has at least one.',
    '  - reveals: fact_refs the reader learns here. Each one must be paid off later.',
    '  - conceals: fact_refs deliberately withheld here, which the reader must not yet learn.',
    `  - state_changes: World Model columns this event changes (${EVENT_STATE_COLUMNS.join(', ')} only).`,
    '    Only for characters or objects actually involved. Move people before you place them:',
    '    a character listed in an event\'s characters_present must either already be at that',
    '    location or be moved there by a state_change in that same event.',
    '  - pays_off: what this event collects, and the earlier event that planted it.',
    '',
    renderPlantPolicy(brief),
    '',
    'AVOID, because they are what every generated story already does: lighthouses, clockmakers,',
    'librarians, cartographers, and the names Elias, Mara, Elara, Silas, Thorne. Not because they',
    'are bad, because they are the default. Go somewhere else.',
  ].join('\n');
}

/**
 * The wire schema. A plain object literal, matching the idiom in `src/writer/response-schema.ts`
 * and for the reason given there: the JSON Schema and Zod dialects disagree about enough
 * (`propertyOrdering` is non-standard, `additionalProperties` differs) that generating one from
 * the other would be a second thing to get wrong. `FabulaArcSchema` validates what comes back.
 */
export function arcResponseJsonSchema(eventCount: number): Record<string, unknown> {
  const factRef = {
    type: 'string',
    description: 'A short lower_snake_case fact slug describing the fact. Never a sentence.',
  };
  const bag = {
    type: 'object',
    description: 'Optional flat scalar attributes. Omit unless a value is genuinely load-bearing.',
    additionalProperties: { type: 'string' },
  };

  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      world_model_seed: {
        type: 'object',
        properties: {
          characters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'char_… , lower_snake_case' },
                name: { type: 'string' },
                location_id: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  description: 'A seeded loc_… id: where they are as the story opens.',
                },
                status: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                goal: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  description: 'What they are trying to do as the story opens. Rarely null.',
                },
                bag,
              },
              required: ['id', 'name', 'location_id', 'status', 'goal'],
              propertyOrdering: ['id', 'name', 'location_id', 'status', 'goal', 'bag'],
            },
          },
          locations: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' }, bag },
              required: ['id', 'name'],
              propertyOrdering: ['id', 'name', 'bag'],
            },
          },
          objects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                location_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                status: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                bag,
              },
              required: ['id', 'name', 'location_id', 'status'],
              propertyOrdering: ['id', 'name', 'location_id', 'status', 'bag'],
            },
          },
          relationships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                from_id: { type: 'string' },
                to_id: { type: 'string' },
                kind: { type: 'string' },
                sentiment: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['id', 'from_id', 'to_id', 'kind', 'sentiment'],
              propertyOrdering: ['id', 'from_id', 'to_id', 'kind', 'sentiment'],
            },
          },
          character_knowledge: {
            type: 'array',
            description:
              'Facts a character already knows when the story opens. learned_at_scene is always ' +
              'null here, and these are the only facts a payoff with plant: null may rest on.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                character_id: { type: 'string' },
                fact_ref: factRef,
                learned_at_scene: { type: 'null' },
              },
              required: ['id', 'character_id', 'fact_ref', 'learned_at_scene'],
              propertyOrdering: ['id', 'character_id', 'fact_ref', 'learned_at_scene'],
            },
          },
        },
        required: ['characters', 'locations', 'objects', 'relationships', 'character_knowledge'],
        propertyOrdering: [
          'characters',
          'locations',
          'objects',
          'relationships',
          'character_knowledge',
        ],
      },
      events: {
        type: 'array',
        // `minItems`/`maxItems` are deliberately absent, and this is a measured constraint rather
        // than a style choice. Measured live on 2026-09-16 against `gemini-3.5-flash-lite` and
        // `gemini-3.8-flash`: with this event object as the item schema, an array bound of **10 or
        // more** is rejected with a bare `400 INVALID_ARGUMENT` carrying no detail, while 9 is
        // accepted — and `minItems: 40` over an array of plain strings is accepted, so the limit is
        // the *unrolled* complexity of bound × item schema, not `minItems` itself. Since a Fabula
        // arc's whole point is 12–28 events, the bound has to go. The count is stated in the
        // prompt instead and checked against what comes back; `docs/research/gemini-capabilities.md`
        // §5 does not currently record this limit and arguably should.
        description: `Exactly ${eventCount} events, in chronological order.`,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ev_NN_short_name, lower_snake_case' },
            sequence: { type: 'integer', description: 'Chronological position, 1-based.' },
            summary: { type: 'string', description: 'One sentence: what happens.' },
            pov: { type: 'string', description: 'A seeded char_… id, also in characters_present.' },
            location_id: { type: 'string' },
            characters_present: { type: 'array', items: { type: 'string' } },
            dramatic_function: {
              type: 'string',
              description: 'What this event is for, in the arc. Not a restatement of the summary.',
            },
            beats: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string' },
              description: 'The things that must happen. Never empty.',
            },
            caused_by: {
              type: 'array',
              items: { type: 'string' },
              description: 'Earlier event ids this follows from causally, not merely after.',
            },
            reveals: {
              type: 'array',
              items: factRef,
              description: 'Facts the reader learns here. Each must be paid off by a later event.',
            },
            conceals: { type: 'array', items: factRef },
            state_changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entity_id: { type: 'string' },
                  column: { type: 'string', enum: [...EVENT_STATE_COLUMNS] },
                  value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['entity_id', 'column', 'value'],
                propertyOrdering: ['entity_id', 'column', 'value'],
              },
            },
            pays_off: {
              type: 'array',
              description:
                'What this event collects. plant is the id of the EARLIER event that planted it ' +
                'and that lists the same fact_ref in its own reveals — or null for a fact seeded ' +
                'in character_knowledge before the story began.',
              items: {
                type: 'object',
                properties: {
                  fact_ref: factRef,
                  plant: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['fact_ref', 'plant'],
                propertyOrdering: ['fact_ref', 'plant'],
              },
            },
          },
          required: [
            'id',
            'sequence',
            'summary',
            'pov',
            'location_id',
            'characters_present',
            'dramatic_function',
            'beats',
            'caused_by',
            'reveals',
            'conceals',
            'state_changes',
            'pays_off',
          ],
          propertyOrdering: [
            'id',
            'sequence',
            'summary',
            'pov',
            'location_id',
            'characters_present',
            'dramatic_function',
            'beats',
            'caused_by',
            'reveals',
            'conceals',
            'state_changes',
            'pays_off',
          ],
        },
      },
    },
    required: ['title', 'world_model_seed', 'events'],
    propertyOrdering: ['title', 'world_model_seed', 'events'],
  };
}
