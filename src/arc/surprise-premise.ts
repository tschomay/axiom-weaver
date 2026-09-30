/**
 * A fresh premise for the Generate tab's "Surprise me" button, invented by the model on each press.
 *
 * The ready-made list in `./random-premises.ts` is finite: press the button enough and it repeats.
 * This asks the model for a new one every time and returns the same `RandomPremise` shape, so the
 * form fills in exactly as it does from the list. The list stays as the offline fallback for when
 * there is no key or the call fails.
 *
 * Diversity comes from the seed, not from decoding temperature
 * (`docs/research/llm-arc-generation-prior-art.md` §2). Asked the same question twice, a model gives
 * the same kind of answer twice. So each call gets a different seed: a plot shape and two unrelated
 * corners of life drawn at random, plus the premises the author has already been shown, which the
 * model is told to move away from. The corners are a push away from the model's defaults, not
 * the idea itself. The model is free to use them loosely.
 */

import { z } from 'zod';
import { PLOT_SHAPE_IDS, materializePlotShape } from './brief';
import type { RandomPremise } from './random-premises';
import type { ModelClient } from '../writer/model-client';

/**
 * Corners of human life to push the model away from its defaults. Each call draws two at random.
 * A long, deliberately mixed list: the point is to land somewhere the model would not have gone.
 */
export const SURPRISE_CORNERS: readonly string[] = [
  'municipal water treatment',
  'competitive ballroom dancing',
  'a salt mine',
  'long-haul trucking',
  'beekeeping cooperatives',
  'a hospital laundry',
  'ice-road construction',
  'a travelling circus winter quarters',
  'deep-sea cable repair',
  'a family-run funeral home',
  'sugar-beet harvest',
  'an orbital station galley',
  'a court interpreters’ office',
  'glassblowing',
  'a ski-lift maintenance crew',
  'pearl diving',
  'a regional radio call-in show',
  'seed banks',
  'a border customs post',
  'amateur astronomy',
  'a dockside fish auction',
  'wedding catering',
  'avalanche forecasting',
  'a monastery brewery',
  'piano tuning',
  'a night-shift bakery',
  'wildfire lookout rotation',
  'an insurance fraud unit',
  'a desert solar farm',
  'competitive pigeon racing',
  'a public swimming baths',
  'a tannery',
  'mountain rescue',
  'a chess club in decline',
  'rail signal boxes',
  'a village dentist',
  'an embassy kitchen',
  'tidal-flat cockle picking',
  'silk farming',
  'a stamp dealer',
  'a lost-property office',
  'a hydroelectric dam',
  'stage magic',
  'a school bus route',
  'an ice-hockey rink Zamboni driver',
  'a translation agency',
  'reindeer herding',
  'a costume workshop at an opera house',
  'a paternity-testing lab',
  'a ferry across a flooded valley',
  'a generation ship’s records office',
  'medieval guild court',
  'a colonial survey expedition',
  'a 1920s telephone exchange',
  'a Bronze Age trading post',
  'a city under wartime blackout',
];

/**
 * What the model must not reach for. The same stock choices `./prompt.ts` tells the arc generator
 * to avoid: a premise that starts from them undoes that instruction before the arc is generated.
 */
export const STOCK_DEFAULTS = /lighthouse|clockmaker|librarian|cartographer|\b(Elias|Mara|Elara|Silas|Thorne)\b/i;

/** How many earlier premises the prompt lists for the model to move away from. */
export const MAX_AVOID = 12;

const ModulesSchema = z.object({
  theme: z.string().trim().min(1),
  setting_time: z.string().trim().min(1),
  setting_place: z.string().trim().min(1),
  protagonist: z.string().trim().min(1),
  protagonist_want: z.string().trim().min(1),
  antagonism: z.string().trim().min(1),
  complication: z.string().trim().min(1),
  ending_shape: z.string().trim().min(1),
});

const SurpriseResponseSchema = z.object({
  title: z.string().trim().min(1),
  logline: z.string().trim().min(1),
  modules: ModulesSchema,
});

function surpriseResponseJsonSchema(): Record<string, unknown> {
  const text = { type: 'string' };
  return {
    type: 'object',
    properties: {
      title: text,
      logline: text,
      modules: {
        type: 'object',
        properties: {
          theme: text,
          setting_time: text,
          setting_place: text,
          protagonist: text,
          protagonist_want: text,
          antagonism: text,
          complication: text,
          ending_shape: text,
        },
        required: [
          'theme',
          'setting_time',
          'setting_place',
          'protagonist',
          'protagonist_want',
          'antagonism',
          'complication',
          'ending_shape',
        ],
        propertyOrdering: [
          'theme',
          'setting_time',
          'setting_place',
          'protagonist',
          'protagonist_want',
          'antagonism',
          'complication',
          'ending_shape',
        ],
      },
    },
    required: ['title', 'logline', 'modules'],
    propertyOrdering: ['title', 'logline', 'modules'],
  };
}

const SYSTEM_INSTRUCTION = `You invent premises for original short stories. Each premise you give is one nobody has read before: a specific person in a specific place and time, wanting something specific, with something concrete in the way.

A good premise:
- is concrete. A named trade, a real-feeling place, a period, an object that matters. Not "a small town" but which town and what it makes.
- has a want the reader can picture being met or failed, and an opposing force that is a person or an institution with its own reasons, not a vague darkness.
- has a complication that changes what the want costs, rather than just making it harder.
- fits the plot shape it is given. The logline alone should make the shape's central question feel urgent.
- is not a fantasy chosen-one story or a twist ending, and not about a writer or an artist finding their voice.

AVOID, because they are what every generated story already does: lighthouses, clockmakers, librarians, cartographers, and the names Elias, Mara, Elara, Silas, Thorne. Go somewhere else.`;

export interface SurpriseSeed {
  readonly plot_shape_preset: string;
  readonly corners: readonly [string, string];
}

/** Draw a fresh seed: a plot shape and two different corners of life. */
export function drawSurpriseSeed(random: () => number = Math.random): SurpriseSeed {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const shape = pick(PLOT_SHAPE_IDS);
  const first = pick(SURPRISE_CORNERS);
  const rest = SURPRISE_CORNERS.filter((corner) => corner !== first);
  return { plot_shape_preset: shape, corners: [first, pick(rest)] };
}

export function surprisePrompt(seed: SurpriseSeed, avoid: readonly string[]): string {
  const shape = materializePlotShape(seed.plot_shape_preset);
  const lines = [
    `Invent one premise for a story shaped as a ${shape.name.toUpperCase()}.`,
    `Its central question: ${shape.central_question}`,
    `Its phases: ${shape.phases.map((phase) => `${phase.name} (${phase.purpose})`).join('; ')}`,
    '',
    `To start you somewhere you would not otherwise go, let one or both of these colour the premise, however loosely: ${seed.corners[0]}; ${seed.corners[1]}. They are a nudge, not a requirement. Do not force both in if the story is better with one.`,
  ];
  if (avoid.length > 0) {
    lines.push(
      '',
      'The author has already been shown these premises. Yours must differ from all of them in setting, trade and kind of conflict:',
      ...avoid.map((logline) => `- ${logline}`),
    );
  }
  lines.push(
    '',
    'Fill every field in a short phrase or one sentence. The title is two to four words and does not start with "The" unless it has to.',
  );
  return lines.join('\n');
}

/**
 * Ask the model for a new premise.
 *
 * One retry if the answer does not parse or reaches for a stock default. A second failure throws,
 * and the route falls back to the ready-made list.
 */
export async function generateSurprisePremise(input: {
  readonly client: ModelClient;
  readonly model: string;
  readonly avoid?: readonly string[];
  readonly random?: () => number;
}): Promise<{ premise: RandomPremise; model: string; seed: SurpriseSeed }> {
  const seed = drawSurpriseSeed(input.random);
  const avoid = (input.avoid ?? []).slice(-MAX_AVOID);
  let lastProblem = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await input.client.generate({
      model: input.model,
      systemInstruction: SYSTEM_INSTRUCTION,
      contents: surprisePrompt(seed, avoid),
      responseJsonSchema: surpriseResponseJsonSchema(),
      maxOutputTokens: 4096,
      thinkingLevel: 'LOW',
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      lastProblem = `the model's answer was not JSON (finish: ${response.finish_reason})`;
      continue;
    }
    const result = SurpriseResponseSchema.safeParse(parsed);
    if (!result.success) {
      lastProblem = `the model's answer was missing fields: ${result.error.issues[0]?.message ?? ''}`;
      continue;
    }
    if (STOCK_DEFAULTS.test(JSON.stringify(result.data))) {
      lastProblem = 'the model reached for a stock default';
      continue;
    }

    return {
      premise: {
        title: result.data.title,
        plot_shape_preset: seed.plot_shape_preset,
        premise: { logline: result.data.logline, modules: result.data.modules },
      },
      model: response.model,
      seed,
    };
  }

  throw new Error(`No usable premise: ${lastProblem}`);
}
