// Indicative difficulty (1–5 bolts) for a planned session, derived from the
// plan's own intensity wording. A presentation heuristic, not physiology:
// recovery < easy aerobic < strength/technique < threshold/sweet-spot work.
// Long outings score by duration on top of their easy base intensity.

export type SessionLike = {
  sport: string;
  title: string;
  intensity: string;
  durationMin: number | null;
};

export function sessionDifficulty(session: SessionLike): number {
  const text = `${session.title} ${session.intensity}`.toLowerCase();
  if (/repos|récupération|tres facile|très facile|z1\b/.test(text) && !/z1–z2|z1-z2/.test(text)) return 1;
  if (/seuil|allure course|ftp|sweet spot|88/.test(text)) return 4;
  if (/côtes|cotes|montées|descentes tech/.test(text)) return 4;
  if (/force|pull|push|jambes|technique/.test(text)) return 3;
  // Aerobic runs and rides: long ones cost more than short ones.
  if ((session.durationMin || 0) >= 75) return 3;
  if (/sortie longue/.test(text)) return 3;
  if (/vallonn/.test(text)) return 3;
  return 2;
}
