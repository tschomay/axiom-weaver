/**
 * The imagery ledger — repetition control that varies the vehicle, never suppresses the domain
 * (ADR 0010).
 *
 * At novel length the writer cannot notice "you have used rain-on-glass four times" by re-reading
 * prose it cannot afford to re-read; `imagery_signature` (ADR 0003) is the only signal cheap
 * enough to carry forward. But a Voice Card's `imagery_palette` explicitly *wants* some of those
 * images to recur — that recurrence is a motif, not a failure.
 *
 * So the ledger is built by domain-tag equality (ADR 0010 decision 3): a plain comparison of the
 * tags the writer already assigned at emission time, no fuzzy matching and no extra call. The
 * instruction it renders is positive-framed and constrains reuse of the same *phrasing* inside a
 * domain — never the domain itself. A raw blocklist was hand-tested in the prototype and
 * declined: it cannot tell "don't repeat this phrasing" from "don't touch this domain", so it
 * suppressed a whole characterful domain and reached for flatter substitutes.
 */

import type { ImagerySignature } from '../digest/scene-digest';
import type { VoiceCard } from './voice-card';

export interface DomainUse {
  readonly domain: string;
  /** Scene `order` values that drew from this domain, ascending. */
  readonly scenes: number[];
  /** The most recent phrasings recorded for it, oldest first. */
  readonly recent_images: string[];
}

export interface ImageryLedger {
  /** Palette domains already drawn from, most recently used last. */
  readonly used: DomainUse[];
  /** Palette domains with no recorded use yet. */
  readonly unused: string[];
  /** Images the writer recorded outside the palette (`domain: null`), most recent last. */
  readonly ad_hoc: string[];
}

/** How many prior phrasings per domain the block shows. Enough to vary against, not a wall. */
const RECENT_IMAGES_SHOWN = 3;

export interface RecordedImagery {
  readonly scene_order: number;
  readonly signature: readonly ImagerySignature[];
}

/**
 * Build the ledger from what earlier scenes actually recorded.
 *
 * Only the palette is authoritative for the "not yet drawn from" list: an ad hoc image is by
 * definition outside the palette, so it can neither fill nor exhaust a domain.
 */
export function buildImageryLedger(
  card: VoiceCard,
  history: readonly RecordedImagery[],
): ImageryLedger {
  const uses = new Map<string, { scenes: number[]; images: string[] }>();
  const adHoc: string[] = [];

  for (const entry of history) {
    for (const signature of entry.signature) {
      if (signature.domain === null) {
        adHoc.push(signature.image);
        continue;
      }
      const use = uses.get(signature.domain) ?? { scenes: [], images: [] };
      if (!use.scenes.includes(entry.scene_order)) use.scenes.push(entry.scene_order);
      use.images.push(signature.image);
      uses.set(signature.domain, use);
    }
  }

  const used: DomainUse[] = [];
  for (const [domain, use] of uses) {
    used.push({
      domain,
      scenes: [...use.scenes].sort((a, b) => a - b),
      recent_images: use.images.slice(-RECENT_IMAGES_SHOWN),
    });
  }
  // Least recently used first, so the block's tail is what the writer just did.
  used.sort((a, b) => lastScene(a) - lastScene(b));

  const unused = card.imagery_palette.filter((domain) => !uses.has(domain));

  return { used, unused, ad_hoc: adHoc };
}

function lastScene(use: DomainUse): number {
  return use.scenes[use.scenes.length - 1] ?? 0;
}

/**
 * Render the `IMAGERY LEDGER` block (ADR 0010 decision 5).
 *
 * Positioned after the Voice Card block and before the scene's tone line — which, across the
 * cache boundary ADR 0008 draws, means inside the volatile tail immediately before tone (ADR 0012
 * decision 2). It reads as refinement within the voice rather than a competing instruction.
 *
 * The block degrades gracefully: once every palette domain has been used at least once there is
 * nothing left for a "not yet drawn from" list, and it becomes a pure "already drawn from" list —
 * still positive-framed, still never a blocklist.
 */
export function renderImageryLedger(ledger: ImageryLedger): string {
  if (ledger.used.length === 0 && ledger.unused.length === 0) return '';

  const lines = [
    'IMAGERY LEDGER (vary the phrasing, not the domain — recurrence inside a domain is licensed, reusing the same wording is not):',
  ];

  for (const use of ledger.used) {
    const scenes = use.scenes.join(', ');
    const gist = use.recent_images.map((image) => `"${image}"`).join('; ');
    lines.push(`  - ${use.domain} — already drawn from (scene${use.scenes.length === 1 ? '' : 's'} ${scenes}): ${gist}`);
  }

  if (ledger.unused.length > 0) {
    lines.push(`  - not yet drawn from: ${ledger.unused.join('; ')}`);
  }

  if (ledger.ad_hoc.length > 0) {
    const recent = ledger.ad_hoc.slice(-RECENT_IMAGES_SHOWN).map((image) => `"${image}"`);
    lines.push(`  - recorded outside the palette: ${recent.join('; ')}`);
  }

  return lines.join('\n');
}

/**
 * Stale imagery: a domain drawn from repeatedly across a window without the phrasing varying.
 *
 * This is the one rubric mode ADR 0010 strengthens detection for, and it is digest-only, so the
 * continuity pass (ADR 0011) can run it without touching prose. Exposed here because the ledger
 * is where the domain tags already live.
 */
export function staleImageryDomains(history: readonly RecordedImagery[]): string[] {
  const byDomain = new Map<string, string[]>();
  for (const entry of history) {
    for (const signature of entry.signature) {
      if (signature.domain === null) continue;
      const images = byDomain.get(signature.domain) ?? [];
      images.push(signature.image.trim().toLowerCase());
      byDomain.set(signature.domain, images);
    }
  }
  const stale: string[] = [];
  for (const [domain, images] of byDomain) {
    if (images.length < 2) continue;
    if (new Set(images).size < images.length) stale.push(domain);
  }
  return stale.sort();
}
