/**
 * One-line pub/sub between the charting screens and the ward alert bar.
 *
 * Signing a dose or ticking off an observation should clear the alert the same
 * second, not on the bar's next 30-second poll. Kept out of the component file
 * so the bar stays a components-only module (React Fast Refresh).
 */
export const ALERTS_CHANGED_EVENT = 'ipd:alerts-changed';

/** Call after anything that could make a pending item go away. */
export function notifyAlertsChanged(): void {
  window.dispatchEvent(new CustomEvent(ALERTS_CHANGED_EVENT));
}
