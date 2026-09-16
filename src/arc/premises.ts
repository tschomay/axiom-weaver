/**
 * The premises the prototype runs, and the three configurations they run under.
 *
 * Two A/Bs, both of which exist because `story-authoring-eval.md` §4.1 and
 * `llm-arc-generation-prior-art.md` §8 name the measurement and neither the ticket nor the
 * research settles the answer:
 *
 * 1. **Typed premise versus free text** (`structured` vs `free_text`). MoPS reports that sampling
 *    a typed module path and fusing it beats a free-text premise for diversity; that is a claim
 *    about a different pipeline, and §4.1's cross-arc diversity check exists precisely so we do
 *    not have to take it on faith. The confound is worth stating rather than hiding: the
 *    structured arm's three runs get three *different* module paths while the free-text arm gets
 *    the *same* logline three times. That is the intervention, not a flaw in it — the question is
 *    whether a typed input surface spreads the output, and the naive free-text usage is one
 *    premise run three times.
 *
 * 2. **Span guidance on versus off** (`structured` vs `no_span_guidance`). §6 accepts arc-level
 *    surprise as the price of interleaving and predicts every plant landing one event ahead of its
 *    payoff. Whether *telling the model otherwise* moves the histogram is the only part of that we
 *    can actually test, and it needs the arm where we do not tell it.
 *
 * The plot shape is held fixed at `mystery` across all three so the histogram and diversity
 * numbers compare like with like. Mystery is also the shape with the most to lose from a span-1
 * graph — a clue planted in the event before it is used is not a clue.
 */

import { materializeBrief, type ArcBrief, type Premise } from './brief';

/** The three typed module paths. Shared theme and ending shape, sampled everything else. */
const TYPED_PREMISES: ReadonlyArray<{ id: string; premise: Premise; title: string }> = [
  {
    id: 'ferry',
    title: 'The Low Water',
    premise: {
      logline:
        'A river ferry sinks in calm water, and the woman who signed off on its last inspection has to find out why before the inquiry does.',
      modules: {
        theme: 'what a person will certify to keep a job that feeds other people',
        setting_time: 'a drought summer, in a country with more paperwork than money',
        setting_place: 'a river crossing town that exists because the ferry does',
        protagonist: 'the district inspector who signed the ferry fit to sail',
        protagonist_want: 'to find the real cause before the inquiry names her as it',
        antagonism: 'the people who need the ferry running more than they need it safe',
        complication: 'the cause turns out to be something she was told about and did not write down',
        ending_shape: 'the truth is established and costs the person who established it',
      },
    },
  },
  {
    id: 'orchard',
    title: 'Grafting Season',
    premise: {
      logline:
        'An orchard loses a whole variety of pear overnight, and the grafter who bred it has to work out which of her neighbours did it and why.',
      modules: {
        theme: 'the difference between owning work and having made it',
        setting_time: 'the last autumn before a cooperative is bought out',
        setting_place: 'a hill orchard shared by four families who no longer speak',
        protagonist: 'a grafter in her sixties who bred the lost variety and never registered it',
        protagonist_want: 'to prove the variety was hers before the sale closes',
        antagonism: 'a neighbour with a legitimate claim and a bad motive',
        complication: 'the person who destroyed the trees did it to protect her',
        ending_shape: 'the truth is established and costs the person who established it',
      },
    },
  },
  {
    id: 'kiln',
    title: 'Firing Two',
    premise: {
      logline:
        'A glaze factory kiln is opened a day early and a worker is found inside, and the shift supervisor who holds the only key has to account for a night she cannot remember clearly.',
      modules: {
        theme: 'how a workplace decides in advance who will be blamed',
        setting_time: 'a winter of short shifts and a failing order book',
        setting_place: 'a glaze works on the edge of a port town',
        protagonist: 'the night shift supervisor, recently promoted from the floor',
        protagonist_want: 'to reconstruct a night she spent too tired to remember properly',
        antagonism: 'a management that has already chosen its account of events',
        complication: 'her own reconstruction keeps producing a version that convicts her',
        ending_shape: 'the truth is established and costs the person who established it',
      },
    },
  },
];

/** The free-text arm: one logline, no modules, run three times. The naive usage. */
const FREE_TEXT_PREMISE: Premise = {
  logline:
    'A mystery in a working town, where the person who has to find out what happened is also the person who will be blamed for it.',
  modules: null,
};

export type ConfigId = 'structured' | 'free_text' | 'no_span_guidance';

export const CONFIG_IDS: readonly ConfigId[] = ['structured', 'free_text', 'no_span_guidance'];

/** The three briefs of a configuration. Three arcs per config is the rubric's §4.2 minimum. */
export function briefsFor(config: ConfigId, eventCount = 20): ArcBrief[] {
  if (config === 'free_text') {
    return [1, 2, 3].map((run) =>
      materializeBrief({
        story_id: `arc_free_text_${run}`,
        title: `Free-text run ${run}`,
        premise: FREE_TEXT_PREMISE,
        plot_shape_preset: 'mystery',
        event_count: eventCount,
        plant_density: 'normal',
        span_guidance: true,
        premise_preset: 'free_text',
      }),
    );
  }

  const spanGuidance = config === 'structured';
  return TYPED_PREMISES.map((entry) =>
    materializeBrief({
      story_id: `arc_${config}_${entry.id}`,
      title: entry.title,
      premise: entry.premise,
      plot_shape_preset: 'mystery',
      event_count: eventCount,
      plant_density: 'normal',
      span_guidance: spanGuidance,
      premise_preset: entry.id,
    }),
  );
}
