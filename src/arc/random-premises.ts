/**
 * Ready-made premises for the Generate tab's "surprise me" button.
 *
 * A fixed list rather than a model call: picking one is free and instant, which matters on a
 * paid key reached from a phone — only the generation the author then confirms spends anything.
 * Each entry is a complete typed premise (the MoPS-style module form `./brief.ts` describes), so
 * the author sees every field filled and can edit any of them before generating.
 *
 * Two per plot shape, and deliberately clear of the defaults `./prompt.ts` tells the generator to
 * avoid (lighthouses, clockmakers, librarians, cartographers, and the stock names) — a random
 * premise that walked straight into them would undo that instruction before the model saw it.
 */

import type { Premise } from './brief';

export interface RandomPremise {
  readonly title: string;
  readonly plot_shape_preset: string;
  readonly premise: Premise & { readonly modules: NonNullable<Premise['modules']> };
}

export const RANDOM_PREMISES: readonly RandomPremise[] = [
  {
    title: 'The Night Count',
    plot_shape_preset: 'mystery',
    premise: {
      logline:
        'A bird survey volunteer finds the season’s rarest sighting was logged from a hide that was locked all night.',
      modules: {
        theme: 'what people will fake to be the one who saw it first',
        setting_time: 'the last week of a spring migration survey',
        setting_place: 'a coastal marsh reserve with three hides and one key',
        protagonist: 'a retired postwoman in her second year of volunteering',
        protagonist_want: 'to know whether the record that made the reserve famous is real',
        antagonism: 'a warden whose funding depends on the sighting standing',
        complication: 'her own notebook places her near the hide that night',
        ending_shape: 'the truth is established and costs the person who established it',
      },
    },
  },
  {
    title: 'Second Pressing',
    plot_shape_preset: 'mystery',
    premise: {
      logline:
        'A vineyard’s whole vintage turns in the barrel, and the cellar hand who topped it up has to work out what went in.',
      modules: {
        theme: 'how a family decides which member is expendable',
        setting_time: 'the winter after a hailstorm took half the crop',
        setting_place: 'a hillside winery run by three siblings who share one cellar',
        protagonist: 'a seasonal cellar hand who is not family',
        protagonist_want: 'to keep her job by proving the spoilage was not her mistake',
        antagonism: 'a sibling who would rather lose the vintage than the argument',
        complication: 'the barrels were spoiled to force a sale she would have wanted',
        ending_shape: 'the truth comes out, and nobody is better off for it',
      },
    },
  },
  {
    title: 'The Ledger Man',
    plot_shape_preset: 'transformation',
    premise: {
      logline:
        'A debt collector who never forgives a late payment is made to spend one week collecting from his own childhood street.',
      modules: {
        theme: 'whether a rule applied fairly can still be cruel',
        setting_time: 'a cold December in a town with one employer left',
        setting_place: 'a terraced street he left thirty years ago',
        protagonist: 'a meticulous debt collector who keeps a list of excuses he has heard',
        protagonist_want: 'to finish the week without making an exception',
        antagonism: 'the neighbours who remember who he used to be',
        complication: 'the largest debt on the list is his late mother’s',
        ending_shape: 'he changes, and pays for it himself',
      },
    },
  },
  {
    title: 'Understudy',
    plot_shape_preset: 'transformation',
    premise: {
      logline:
        'A touring actor who has played the same villain for eleven years is told she will be replaced by the understudy she trained.',
      modules: {
        theme: 'what is left of someone who has only ever been one part',
        setting_time: 'the final three weeks of a long regional tour',
        setting_place: 'a string of half-empty provincial theatres',
        protagonist: 'a lead actor who has never missed a performance',
        protagonist_want: 'to make the company regret the decision before closing night',
        antagonism: 'a producer who thinks loyalty is a cost',
        complication: 'the understudy is better than she was, and kinder',
        ending_shape: 'she lets go of the part and keeps something truer',
      },
    },
  },
  {
    title: 'Salt Road',
    plot_shape_preset: 'quest',
    premise: {
      logline:
        'A boy sent to fetch medicine across the salt flats learns the town sent him because no one else would come back.',
      modules: {
        theme: 'what a community owes the people it spends',
        setting_time: 'the dry season, after the last caravan failed to return',
        setting_place: 'a salt-flat crossing between a mining town and a coast',
        protagonist: 'a twelve-year-old who has never left town',
        protagonist_want: 'to bring the medicine back before his sister’s fever turns',
        antagonism: 'the flats themselves, and a trader who profits from the shortage',
        complication: 'the medicine is real, but so is the reason nobody else went',
        ending_shape: 'he returns changed, and the town must change to take him back',
      },
    },
  },
  {
    title: 'The Borrowed Boat',
    plot_shape_preset: 'quest',
    premise: {
      logline:
        'Two estranged sisters sail their father’s old boat down the coast to scatter his ashes where he said, and neither believes him.',
      modules: {
        theme: 'how the dead keep arguing through what they leave',
        setting_time: 'a week of unreliable autumn weather',
        setting_place: 'a rocky coastline of fishing harbours in decline',
        protagonist: 'the younger sister, who stayed and nursed him',
        protagonist_want: 'to finish the trip without admitting what he told her',
        antagonism: 'the older sister, who wants to sell the boat at the end',
        complication: 'the place he named is where he had a second family',
        ending_shape: 'they arrive, and the destination is not what the trip was for',
      },
    },
  },
  {
    title: 'The Night Shift Letter',
    plot_shape_preset: 'courtship',
    premise: {
      logline:
        'Two hospital porters on opposite shifts fall for each other through notes left in a shared locker, and one of them is not who the notes suggest.',
      modules: {
        theme: 'whether you can love someone you have only ever read',
        setting_time: 'a hard winter of staff shortages',
        setting_place: 'a large city hospital, its basements and loading bays',
        protagonist: 'a day porter saving to leave the city',
        protagonist_want: 'to meet the night porter without ruining it',
        antagonism: 'a rota that never lets them overlap, and a supervisor who reads the notes',
        complication: 'the notes were started by someone else, as a joke',
        ending_shape: 'they meet as themselves and choose each other anyway',
      },
    },
  },
  {
    title: 'Terms of Sale',
    plot_shape_preset: 'courtship',
    premise: {
      logline:
        'An estate agent falls for the one buyer who can see what is wrong with the house she is desperate to sell.',
      modules: {
        theme: 'honesty as a thing that costs money',
        setting_time: 'a falling property market',
        setting_place: 'a seaside town where every other house is for sale',
        protagonist: 'an estate agent one bad month from losing the agency',
        protagonist_want: 'to close the sale without lying outright',
        antagonism: 'her own need for the commission',
        complication: 'the buyer is a surveyor pretending not to be one',
        ending_shape: 'the sale falls through and the relationship does not',
      },
    },
  },
  {
    title: 'Toll',
    plot_shape_preset: 'reckoning',
    premise: {
      logline:
        'A woman whose farm was flooded to build a reservoir takes a job on the dam, to learn how it could be made to fail.',
      modules: {
        theme: 'whether revenge on a thing can ever reach the people behind it',
        setting_time: 'twenty years after the valley was flooded',
        setting_place: 'a hydroelectric dam above a drowned village',
        protagonist: 'a maintenance engineer who grew up in the drowned valley',
        protagonist_want: 'to make the reservoir give back what it took',
        antagonism: 'the dam’s manager, who signed the flooding order young',
        complication: 'the town below the dam now depends on it',
        ending_shape: 'the vow is kept to the letter and broken in spirit',
      },
    },
  },
  {
    title: 'The Apprentice’s Bill',
    plot_shape_preset: 'reckoning',
    premise: {
      logline:
        'A chef who was blacklisted by his mentor finally gets a table at the mentor’s restaurant on the night it is being reviewed.',
      modules: {
        theme: 'what we owe the people who made us and then unmade us',
        setting_time: 'a single service night, with years of history behind it',
        setting_place: 'an acclaimed restaurant kitchen and dining room',
        protagonist: 'a line cook who once ran that kitchen’s pastry section',
        protagonist_want: 'to see his mentor fail in front of the critic',
        antagonism: 'the mentor, older now, and frightened',
        complication: 'the dish that ruined him is on tonight’s menu, credited to the mentor',
        ending_shape: 'he could ruin the night, and what he does instead is the answer',
      },
    },
  },
];

/** Any premise but `current` where there is a choice, so pressing the button always changes something. */
export function pickRandomPremise(
  current: string | null = null,
  random: () => number = Math.random,
): RandomPremise {
  const pool =
    RANDOM_PREMISES.length > 1
      ? RANDOM_PREMISES.filter((entry) => entry.title !== current)
      : RANDOM_PREMISES;
  return pool[Math.floor(random() * pool.length)] ?? RANDOM_PREMISES[0]!;
}
