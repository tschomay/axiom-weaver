/**
 * Mechanical withholding and single reveals for a segmented package (#196).
 *
 * A generated arc knows both ends of every secret: the event that conceals a fact (or the hidden
 * account step that makes it true) and the event that reveals it. Before this, only the concealing
 * event's own scene carried `must_stay_hidden`; the scenes between it and the reveal were left to
 * `findWithholding`, a model pass that is only asked about facts some card already reveals. Panel
 * batch 2026-09-29 showed what that costs: a secret the POV character knew all along "discovered"
 * in scene 1 and confessed in scene 5, and one forgery revealed as news four times.
 *
 * Everything here is deterministic over the cards, in this order:
 *
 * 1. A hidden-account fact no card reveals, but some card pays off, is revealed on the first card
 *    that pays it off — that is where it surfaces, and the told-ledger should record it there.
 * 2. A fact in `reader_must_learn` on two cards keeps the first; every later card retells it
 *    (`recounts`, ADR 0022's amendment) instead of revealing it again. A payoff whose plant was a
 *    later reveal is re-pointed at the first one.
 * 3. A fact concealed at scene A stays in `must_stay_hidden` on every scene from A until the first
 *    scene after A that reveals or pays it off; a hidden-account fact, from scene 1.
 */

import type { SceneCard } from '../schema/story-package';

export interface SecretWiringReport {
  /** Hidden-account facts given a `reader_must_learn` on the card that first paid them off. */
  readonly revealed_at_payoff: number;
  /** Hidden-account facts nothing revealed or paid off, revealed on the final-phase card (#216). */
  readonly revealed_at_final_phase: number;
  /** Later `reader_must_learn` entries turned into `recounts`. */
  readonly reveals_made_recounts: number;
  /** `must_stay_hidden` entries added to carry a secret to its reveal. */
  readonly withheld_entries: number;
}

function surfaces(scene: SceneCard, fact: string): boolean {
  return (
    scene.reader_must_learn.includes(fact) ||
    scene.pays_off.some((payoff) => payoff.fact_ref === fact)
  );
}

export function wireSecrets(
  scenes: SceneCard[],
  hiddenFacts: readonly string[],
  options: {
    /**
     * Where a hidden-account fact that nothing reveals or pays off is revealed (#216): the first
     * card of the brief's final phase, or the last card when the brief names no phases. Without
     * it such a fact fails `hidden_fact_never_revealed`, which refused 2 of 5 random arcs at
     * publish in the #204 re-run.
     */
    readonly fallbackRevealSceneId?: string;
  } = {},
): SecretWiringReport {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);

  let revealedAtPayoff = 0;
  let revealedAtFallback = 0;
  const fallback =
    ordered.find((scene) => scene.id === options.fallbackRevealSceneId) ?? ordered[ordered.length - 1];
  for (const fact of new Set(hiddenFacts)) {
    if (ordered.some((scene) => scene.reader_must_learn.includes(fact))) continue;
    const surfacing = ordered.find((scene) =>
      scene.pays_off.some((payoff) => payoff.fact_ref === fact),
    );
    if (surfacing !== undefined) {
      surfacing.reader_must_learn.push(fact);
      revealedAtPayoff += 1;
      continue;
    }
    if (fallback === undefined) continue;
    fallback.reader_must_learn.push(fact);
    revealedAtFallback += 1;
  }

  let recounted = 0;
  const firstReveal = new Map<string, SceneCard>();
  const movedFrom = new Map<string, Map<string, string>>();
  for (const scene of ordered) {
    const kept: string[] = [];
    for (const fact of scene.reader_must_learn) {
      const first = firstReveal.get(fact);
      if (first === undefined) {
        firstReveal.set(fact, scene);
        kept.push(fact);
        continue;
      }
      if (kept.includes(fact)) continue;
      const recounts = scene.recounts ?? [];
      if (!recounts.includes(fact)) scene.recounts = [...recounts, fact];
      const moved = movedFrom.get(fact) ?? new Map<string, string>();
      moved.set(scene.id, first.id);
      movedFrom.set(fact, moved);
      recounted += 1;
    }
    scene.reader_must_learn = kept;
  }
  for (const scene of ordered) {
    scene.pays_off = scene.pays_off.map((payoff) => {
      const to = payoff.plant === null ? undefined : movedFrom.get(payoff.fact_ref)?.get(payoff.plant);
      return to === undefined ? payoff : { ...payoff, plant: to };
    });
  }

  const withheld = extendWithholding(scenes, hiddenFacts);

  return {
    revealed_at_payoff: revealedAtPayoff,
    revealed_at_final_phase: revealedAtFallback,
    reveals_made_recounts: recounted,
    withheld_entries: withheld,
  };
}

/**
 * Carry every concealment forward to its reveal (step 3 above), and withhold every hidden-account
 * fact from scene 1. Idempotent, so it runs again after `findWithholding` (#216): a concealment
 * that model pass adds would otherwise stop at its own scene — `helen_sabotage_exposed` was hidden
 * at scene 14 and not 15, then revealed at 16.
 */
export function extendWithholding(scenes: SceneCard[], hiddenFacts: readonly string[]): number {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  let withheld = 0;
  const hide = (scene: SceneCard, fact: string): void => {
    if (scene.must_stay_hidden.includes(fact)) return;
    scene.must_stay_hidden.push(fact);
    withheld += 1;
  };
  const concealments: Array<{ fact: string; from: number }> = [];
  ordered.forEach((scene, at) => {
    for (const fact of scene.must_stay_hidden) concealments.push({ fact, from: at });
  });
  for (const fact of new Set(hiddenFacts)) concealments.push({ fact, from: 0 });

  for (const { fact, from } of concealments) {
    if (surfaces(ordered[from]!, fact)) continue;
    for (let at = from; at < ordered.length; at += 1) {
      const scene = ordered[at]!;
      if (surfaces(scene, fact)) break;
      hide(scene, fact);
    }
  }

  return withheld;
}
