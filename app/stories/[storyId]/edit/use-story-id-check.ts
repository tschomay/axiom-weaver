'use client';

import { useEffect, useState } from 'react';

export type IdVerdict = 'unknown' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Whether a `story_id` is free, asked while the author is still typing.
 *
 * The verdict is stored **with the id it was about**, and read back only when that id is still
 * the one on screen. Otherwise a slower answer about a previous keystroke would arrive and claim
 * to be about this one — the same reason the save path carries `updated_at` rather than trusting
 * order (ADR 0017 §8), at a smaller scale.
 *
 * The claim this makes is advisory either way. The authoritative check is the one the write path
 * performs, because two tabs can both be told "free".
 */
export function useStoryIdCheck(candidate: string, enabled: boolean): IdVerdict {
  const [answer, setAnswer] = useState<{ id: string; verdict: IdVerdict }>({
    id: '',
    verdict: 'unknown',
  });

  useEffect(() => {
    if (!enabled || candidate === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetch(`/api/authoring/story-id-available?id=${encodeURIComponent(candidate)}`)
        .then((response) => response.json() as Promise<{ available?: boolean; valid?: boolean }>)
        .then((body) => {
          if (cancelled) return;
          setAnswer({
            id: candidate,
            verdict:
              body.valid === false ? 'invalid' : body.available === true ? 'free' : 'taken',
          });
        })
        .catch(() => {
          // No answer is not the same as "taken": the button stays disabled, and the write path
          // is what actually decides.
          if (!cancelled) setAnswer({ id: candidate, verdict: 'unknown' });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, enabled]);

  if (!enabled || candidate === '') return 'unknown';
  return answer.id === candidate ? answer.verdict : 'checking';
}
