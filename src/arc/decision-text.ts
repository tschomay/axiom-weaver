/**
 * Whether a beat or an event summary turns on a decision (#199). A leaf module: the arc's
 * motivation gate, segmentation's trigger rule and the writer prompt all read it.
 */

export const DECISION_PATTERN =
  /\b(decid(?:e|es|ed|ing)|choos(?:e|es|ing)|chose|realiz(?:e|es|ed|ing)|realis(?:e|es|ed|ing)|confess(?:es|ed|ing)?|forgiv(?:e|es|ing)|forgave|resolv(?:e|es|ed)\s+to|refus(?:e|es|ed|ing)|agree(?:s|d)?\s+to|gives?\s+up|gave\s+up|betray(?:s|ed)?|relents?|relented)\b/i;

export function isDecisionText(text: string): boolean {
  return DECISION_PATTERN.test(text);
}

