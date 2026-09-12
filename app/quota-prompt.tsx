'use client';

import type { QuotaOffer } from '@/writer/model-client';

/**
 * What a spent daily quota offers, put to the person who has to live with the answer.
 *
 * The rule this exists to keep is `AGENTS.md`'s: never degrade the writer model silently to dodge
 * a quota. Reaching for the headroom model is a real trade — many times the daily allowance, and
 * prose the project must not be judged by — so it is a decision, taken here, and the surface that
 * shows the result says which model wrote it either way.
 *
 * Failing outright was the other option, and it is the worse one: the author is told the day is
 * over when there is in fact a way to keep working, just not one anything should take on their
 * behalf.
 */
export function QuotaPrompt({
  offer,
  what,
  busy,
  onProceed,
  onDismiss,
}: {
  offer: QuotaOffer;
  /** What the retry would do, in the caller's own words: "compile this scene", "start a telling". */
  what: string;
  busy: boolean;
  onProceed: (model: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="panel quota-prompt">
      <h3>
        <code>{offer.model}</code> has no requests left today
      </h3>
      <p className="meta">
        A per-day allowance, not a per-minute one: it clears at midnight Pacific, and the capacity
        fallback has already been tried. Waiting a minute will not help.
      </p>

      {offer.retry_with_model === null ? (
        <p className="meta">
          That is already the model with the largest daily allowance this deployment will call, so
          there is nothing further to offer. This key already has billing attached; what is left
          is waiting for the reset, or the limit rising further as cumulative spend moves the key
          to a higher tier — neither of which anything here can do on the spot.
        </p>
      ) : (
        <>
          <p className="meta">
            <code>{offer.retry_with_model}</code> carries a much larger daily allowance. It is the
            right model for proving the mechanism works and the wrong one for judging the writing —
            whatever it produces will be recorded as written by it, so nothing downstream mistakes
            it for the writer model&apos;s work.
          </p>
          <div className="actions">
            <button
              type="button"
              className="action primary"
              disabled={busy}
              onClick={() => onProceed(offer.retry_with_model!)}
            >
              {busy ? 'Working…' : `${what} with ${offer.retry_with_model}`}
            </button>
            <button type="button" className="action" disabled={busy} onClick={onDismiss}>
              Not now
            </button>
          </div>
        </>
      )}

      <details>
        <summary className="meta">what the API said</summary>
        <pre className="meta quota-detail">{offer.detail}</pre>
      </details>
    </div>
  );
}
