/**
 * The facts table (ADR 0022): a statement and a causal link for a `fact_ref`.
 *
 * The slug is still the identity every mechanism matches on — the told-ledger, `facts_revealed`,
 * the plant walk. What this module adds is the reading side: the claim a slug stands for, and the
 * causal order a retelling has to keep. Everything here is a pure function of the table, so the
 * assembler, the linter, segmentation and the author's discourse view read one answer.
 */

import type { Fact } from './story-package';

/** A package's table, or none. Absent and empty mean the same thing. */
export function factsOf(pkg: { facts?: readonly Fact[] | undefined }): readonly Fact[] {
  return pkg.facts ?? [];
}

export class FactIndex {
  private readonly byRef = new Map<string, Fact>();
  /** Table order, used to break ties so the rendered order is stable. */
  private readonly position = new Map<string, number>();
  private readonly effects = new Map<string, string[]>();

  constructor(facts: readonly Fact[]) {
    for (const fact of facts) {
      if (this.byRef.has(fact.fact_ref)) continue;
      this.byRef.set(fact.fact_ref, fact);
      this.position.set(fact.fact_ref, this.position.size);
    }
    for (const fact of this.byRef.values()) {
      for (const cause of fact.caused_by) {
        if (!this.byRef.has(cause)) continue;
        this.effects.set(cause, [...(this.effects.get(cause) ?? []), fact.fact_ref]);
      }
    }
  }

  get size(): number {
    return this.byRef.size;
  }

  get(factRef: string): Fact | null {
    return this.byRef.get(factRef) ?? null;
  }

  statement(factRef: string): string | null {
    return this.byRef.get(factRef)?.statement ?? null;
  }

  /** Whether a fact takes part in any causal link, in either direction. */
  isLinked(factRef: string): boolean {
    const fact = this.byRef.get(factRef);
    if (fact === undefined) return false;
    return (
      fact.caused_by.some((cause) => this.byRef.has(cause)) ||
      (this.effects.get(factRef)?.length ?? 0) > 0
    );
  }

  /**
   * Every fact causally connected to `seeds`, causes before effects (ADR 0022 decision 3).
   *
   * Connected means reachable through `caused_by` in either direction — a recap of an incident
   * needs the steps downstream of the fact it names as much as the ones upstream. Seeds with no
   * link at all contribute nothing: their statement already renders beside the slug.
   */
  account(seeds: Iterable<string>): Fact[] {
    const reached = new Set<string>();
    const queue = [...seeds].filter((ref) => this.isLinked(ref));
    while (queue.length > 0) {
      const ref = queue.pop()!;
      if (reached.has(ref)) continue;
      reached.add(ref);
      const fact = this.byRef.get(ref)!;
      for (const next of [...fact.caused_by, ...(this.effects.get(ref) ?? [])]) {
        if (this.byRef.has(next) && !reached.has(next)) queue.push(next);
      }
    }
    return this.causalOrder([...reached]);
  }

  /** Kahn's algorithm, ties broken by table order; a cycle's leftovers follow in table order. */
  private causalOrder(refs: string[]): Fact[] {
    const members = new Set(refs);
    const pending = new Map(
      refs.map((ref) => [
        ref,
        this.byRef.get(ref)!.caused_by.filter((cause) => members.has(cause) && cause !== ref).length,
      ]),
    );
    const byPosition = (a: string, b: string) => this.position.get(a)! - this.position.get(b)!;
    const ready = refs.filter((ref) => pending.get(ref) === 0).sort(byPosition);
    const ordered: string[] = [];

    while (ready.length > 0) {
      const ref = ready.shift()!;
      ordered.push(ref);
      for (const effect of this.effects.get(ref) ?? []) {
        if (!members.has(effect) || !pending.has(effect)) continue;
        const left = pending.get(effect)! - 1;
        pending.set(effect, left);
        if (left === 0) {
          ready.push(effect);
          ready.sort(byPosition);
        }
      }
    }
    const placed = new Set(ordered);
    ordered.push(...refs.filter((ref) => !placed.has(ref)).sort(byPosition));
    return ordered.map((ref) => this.byRef.get(ref)!);
  }
}

export interface FactTableProblem {
  readonly code: 'fact_duplicate' | 'fact_unknown_cause' | 'fact_cycle';
  readonly fact_ref: string;
  readonly message: string;
}

/** The table's own shape: one entry per slug, causes that exist, no cycle. */
export function factTableProblems(facts: readonly Fact[]): FactTableProblem[] {
  const problems: FactTableProblem[] = [];
  const known = new Set<string>();
  for (const fact of facts) {
    if (known.has(fact.fact_ref)) {
      problems.push({
        code: 'fact_duplicate',
        fact_ref: fact.fact_ref,
        message: `"${fact.fact_ref}" has more than one statement`,
      });
    }
    known.add(fact.fact_ref);
  }
  for (const fact of facts) {
    for (const cause of fact.caused_by) {
      if (!known.has(cause)) {
        problems.push({
          code: 'fact_unknown_cause',
          fact_ref: fact.fact_ref,
          message: `"${fact.fact_ref}" is caused_by "${cause}", which has no statement in facts`,
        });
      }
    }
  }

  // A cycle is any fact reachable from itself. Depth-first with three colours.
  const causes = new Map(facts.map((fact) => [fact.fact_ref, fact.caused_by]));
  const state = new Map<string, 'open' | 'done'>();
  const inCycle = new Set<string>();
  const visit = (ref: string, path: string[]): void => {
    if (state.get(ref) === 'done') return;
    if (state.get(ref) === 'open') {
      for (const member of path.slice(path.indexOf(ref))) inCycle.add(member);
      return;
    }
    state.set(ref, 'open');
    for (const cause of causes.get(ref) ?? []) {
      if (causes.has(cause)) visit(cause, [...path, ref]);
    }
    state.set(ref, 'done');
  };
  for (const fact of facts) visit(fact.fact_ref, []);
  for (const ref of inCycle) {
    problems.push({
      code: 'fact_cycle',
      fact_ref: ref,
      message: `"${ref}" is part of a caused_by cycle — a fact cannot be its own cause`,
    });
  }
  return problems;
}

/** One step of a generated hidden account (ADR 0022 decision 4), structurally. */
export interface HiddenStepLike {
  readonly id: string;
  readonly sequence: number;
  readonly summary: string;
  readonly caused_by: readonly string[];
  readonly establishes: readonly string[];
}

/**
 * Fold a hidden account into the facts table (ADR 0022 decision 5).
 *
 * A fact a step establishes takes the step's summary as its statement when the table has none,
 * and inherits, as `caused_by`, the facts established by the steps that step was caused by — so
 * the step-level chain survives the package boundary as a fact-level one. Explicit table entries
 * win on the statement and keep their own causes; the step's are unioned in.
 */
export function mergeHiddenAccount(
  facts: readonly Fact[],
  steps: readonly HiddenStepLike[],
): Fact[] {
  const table = new Map<string, Fact>();
  for (const fact of facts) if (!table.has(fact.fact_ref)) table.set(fact.fact_ref, fact);

  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map(ordered.map((step) => [step.id, step]));
  // The hidden account's own facts first, in step order: where two causes are independent, the
  // account then reads in the order the incident happened.
  const merged = new Map<string, Fact>();
  for (const step of ordered) {
    for (const ref of step.establishes) {
      const existing = merged.get(ref) ?? table.get(ref);
      merged.set(ref, {
        fact_ref: ref,
        statement: existing?.statement ?? step.summary,
        caused_by: [...(existing?.caused_by ?? [])],
      });
    }
  }
  for (const fact of table.values()) {
    if (!merged.has(fact.fact_ref)) merged.set(fact.fact_ref, { ...fact, caused_by: [...fact.caused_by] });
  }

  // Inherited causes last, and only where they keep the graph acyclic: a step chain that loops
  // back on itself is a malformed account, and a cycle would make "causes before effects"
  // meaningless downstream.
  for (const step of ordered) {
    const inherited = step.caused_by.flatMap((id) => byId.get(id)?.establishes ?? []);
    for (const ref of step.establishes) {
      const fact = merged.get(ref)!;
      for (const cause of inherited) {
        if (cause === ref || fact.caused_by.includes(cause)) continue;
        if (reachesThroughCauses(merged, cause, ref)) continue;
        fact.caused_by.push(cause);
      }
    }
  }
  return [...merged.values()];
}

/** Whether `target` is `from` or one of its (transitive) causes. */
export function reachesThroughCauses(
  facts: ReadonlyMap<string, Fact>,
  from: string,
  target: string,
): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const ref = stack.pop()!;
    if (ref === target) return true;
    if (seen.has(ref)) continue;
    seen.add(ref);
    stack.push(...(facts.get(ref)?.caused_by ?? []));
  }
  return false;
}
