/**
 * The variance contract — what may differ between two reads (ADR 0006).
 *
 * Same story, told uniquely on every generation, is the product's whole proposition, so what is
 * *allowed* to differ has to be a contract the code enforces rather than a hope. Each Scene Card
 * declares its invariants; everything unnamed is free.
 *
 * Detection is split, deliberately, and not duplicated. `reader_must_learn`, `must_stay_hidden`
 * and `exit_state` are already structured, so verifying them is a lookup against the Scene Digest
 * — that is what this module does. `required_beats` is **not** independently re-verified here:
 * it is self-reported by the writer via its own `beat_unsatisfied` diagnostic. Re-deriving beat
 * satisfaction from the digest's free-text `event_summary` would be a second fuzzy checker
 * grading the writer's own fuzzy self-report, which adds cost, not reliability.
 */

import type { SceneCard } from '../schema/story-package';
import type { SceneDigest } from '../digest/scene-digest';
import type { WriterDiagnostic } from '../writer/response-schema';

export interface VarianceFinding {
  readonly code:
    | 'reader_must_learn_missed'
    | 'must_stay_hidden_violation'
    | 'beat_unsatisfied'
    | 'plant_obligation_missed'
    | 'payoff_not_closed';
  readonly fact_ref: string | null;
  readonly detail: string;
  /** Whether a retry can still correct this at read time. */
  readonly correctable: boolean;
}

export interface VarianceCheckInput {
  readonly scene: SceneCard;
  readonly digest: SceneDigest;
  readonly writerDiagnostics: readonly WriterDiagnostic[];
  /** Plant obligations this scene owed, from ADR 0004's walk. */
  readonly owedPlants: readonly string[];
}

/**
 * The mechanical half of the contract.
 *
 * `must_stay_hidden` is marked uncorrectable, which is ADR 0006 decision 4's documented exception
 * rather than an oversight: `propertyOrdering` puts `prose` first specifically so it streams to
 * the reader immediately, so by the time the digest reveals a violation the reader has likely
 * already read the leaked secret. A retry cannot un-show prose that already streamed. The only
 * real defense is the prompt-level emphasis in the writer contract, and this check exists to log
 * that the defense failed, not to repair it.
 */
export function checkVarianceContract(input: VarianceCheckInput): VarianceFinding[] {
  const findings: VarianceFinding[] = [];
  const revealed = new Set(input.digest.facts_revealed);

  for (const fact of input.scene.reader_must_learn) {
    if (!revealed.has(fact)) {
      findings.push({
        code: 'reader_must_learn_missed',
        fact_ref: fact,
        detail: `the scene was required to reveal "${fact}", but its digest does not report it in facts_revealed`,
        correctable: true,
      });
    }
  }

  for (const fact of input.scene.must_stay_hidden) {
    if (revealed.has(fact)) {
      findings.push({
        code: 'must_stay_hidden_violation',
        fact_ref: fact,
        detail: `"${fact}" had to stay hidden but appears in facts_revealed — the prose has already reached the reader, so this is log-only`,
        correctable: false,
      });
    }
  }

  const opened = new Set(input.digest.plants_opened);
  for (const fact of input.owedPlants) {
    if (!opened.has(fact)) {
      findings.push({
        code: 'plant_obligation_missed',
        fact_ref: fact,
        detail: `the scene owed a plant for "${fact}" but did not report it in plants_opened — this is the "dropped setup" rubric mode`,
        correctable: true,
      });
    }
  }

  const closed = new Set(input.digest.payoffs_closed);
  for (const payoff of input.scene.pays_off) {
    if (!closed.has(payoff.fact_ref)) {
      findings.push({
        code: 'payoff_not_closed',
        fact_ref: payoff.fact_ref,
        detail: `the scene declares it pays off "${payoff.fact_ref}" but did not report it in payoffs_closed`,
        correctable: true,
      });
    }
  }

  // The writer's own beat self-report is carried through as a finding rather than re-derived.
  for (const diagnostic of input.writerDiagnostics) {
    if (diagnostic.type !== 'beat_unsatisfied') continue;
    findings.push({
      code: 'beat_unsatisfied',
      fact_ref: null,
      detail: diagnostic.detail,
      correctable: true,
    });
  }

  return findings;
}

/**
 * Whether a set of findings warrants the one bounded retry.
 *
 * ADR 0006 decision 3: read-time gets one retry with the same instruction restated, then
 * accept-and-log; author-time warns immediately and never auto-retries, because the author is
 * right there and can just fix the card. A finding that no retry can correct never triggers one.
 */
export function shouldRetry(
  findings: readonly VarianceFinding[],
  occasion: 'author_time' | 'read_time',
): boolean {
  if (occasion === 'author_time') return false;
  return findings.some((finding) => finding.correctable);
}

// The exit-state half of the contract is deliberately not re-implemented here. ADR 0006 decision 1
// lists `exit_state` among the structured invariants, and it *is* verified mechanically — but by
// ADR 0005's state-update authority validator (`src/validator/state-update-authority.ts`), which
// already compares every proposed update against `exit_state` and emits `exit_state_contradiction`.
// Checking it a second time here would mean two mechanisms owning one rule, and they would
// eventually disagree.
