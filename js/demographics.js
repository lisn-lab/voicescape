// Demographics storage. Collected once on the visitor's first share (folded into
// the share card, see contribute.js) and cached here, so later shares skip the
// questions. Device-only — nothing is uploaded until a share carries it.

import { DEMOGRAPHICS_KEY } from './submission.js';

export function getStoredDemographics() {
  try { return JSON.parse(localStorage.getItem(DEMOGRAPHICS_KEY)); }
  catch { return null; }
}

export function saveDemographics(d) {
  localStorage.setItem(DEMOGRAPHICS_KEY, JSON.stringify({ ...d, filledAt: new Date().toISOString() }));
}
