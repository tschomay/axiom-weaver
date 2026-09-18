/**
 * The durability seam Vercel Workflows' `"use step"` goes on (ADR 0014 §2), promoted out of the
 * read-time run loop so an Authoring run (ADR 0021) can share it without importing anything
 * scene-shaped from `./run-loop`.
 */

/** One durable unit of work. On Vercel this is a `"use step"` function; inline everywhere else. */
export type StepRunner = <T>(name: string, run: () => Promise<T>) => Promise<T>;

export const inlineStepRunner: StepRunner = (_name, run) => run();
