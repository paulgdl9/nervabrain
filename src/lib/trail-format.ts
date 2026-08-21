// Pure presentation helpers, safe to import from client components. Keep this
// module free of Node built-ins (fs, path, …) so it never drags the server-only
// trail.ts data layer into a client bundle. Only type-only imports from trail.ts
// are allowed here (they are erased at build time).
import type { SportKind, TrailActivity, TrailFeedback } from "./trail";

export type ActivityDiscipline = "run" | "ride" | "strength" | "swim" | "hike" | "other";

export function activityDiscipline(activity: Pick<TrailActivity, "kind" | "type" | "name">): ActivityDiscipline {
  if (activity.kind !== "other") return activity.kind;
  const text = `${activity.type} ${activity.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/swim|natation|nage|pool/.test(text)) return "swim";
  if (/hik|walk|randon|trek/.test(text)) return "hike";
  return "other";
}

export function heartRateZoneDistribution(activity: Pick<TrailActivity, "durS" | "hrZones" | "timeInZone2S">) {
  if (!activity.hrZones.length && activity.timeInZone2S === null) return null;
  const knownSeconds = activity.hrZones.reduce((sum, zone) => sum + zone.seconds, 0);
  const total = knownSeconds || activity.durS;
  if (!total) return null;
  const percent = (seconds: number) => Math.round(seconds / total * 100);
  const z1Seconds = activity.hrZones.filter((zone) => zone.zone === 1).reduce((sum, zone) => sum + zone.seconds, 0);
  const z2Seconds = activity.hrZones.filter((zone) => zone.zone === 2).reduce((sum, zone) => sum + zone.seconds, 0) || activity.timeInZone2S || 0;
  const z3PlusSeconds = activity.hrZones.filter((zone) => zone.zone >= 3).reduce((sum, zone) => sum + zone.seconds, 0);
  return {
    z1: activity.hrZones.length ? percent(z1Seconds) : null,
    z2: percent(z2Seconds),
    z3Plus: activity.hrZones.length ? percent(z3PlusSeconds) : null,
  };
}

export function fmtPace(paceSPerKm: number | null): string {
  if (!paceSPerKm) return "";
  const m = Math.floor(paceSPerKm / 60);
  const s = Math.round(paceSPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function fmtDur(durS: number): string {
  const s = Math.round(durS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}'${String(s % 60).padStart(2, "0")}`;
}

export function fmtKm(km: number, digits = 1, locale: "fr" | "en" = "fr"): string {
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(km)} km`;
}

export function fmtMinutes(minutes: number): string {
  return fmtDur(minutes * 60);
}

export function selectedTrailWeek(raw: string | undefined, currentWeek: number, weeksTotal: number): number {
  const requested = Number.parseInt(raw || "", 10);
  return Number.isFinite(requested) ? Math.min(weeksTotal, Math.max(1, requested)) : currentWeek;
}

export function sportLabel(sport: SportKind, locale: "fr" | "en" = "fr"): string {
  if (sport === "run") return locale === "fr" ? "Course" : "Running";
  if (sport === "ride") return locale === "fr" ? "Vélo" : "Cycling";
  if (sport === "strength") return locale === "fr" ? "Musculation" : "Strength";
  if (sport === "recovery") return locale === "fr" ? "Récupération" : "Recovery";
  return locale === "fr" ? "Activité" : "Activity";
}

export function activitySummary(activity: TrailActivity, locale: "fr" | "en" = "fr"): string[] {
  const parts = [fmtDur(activity.durS)];
  if (activity.km) parts.push(fmtKm(activity.km, 1, locale));
  if (activity.kind === "run" && activity.paceSPerKm) parts.push(fmtPace(activity.paceSPerKm));
  if (activity.kind === "ride" && activity.km && activity.durS) parts.push(`${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }).format(activity.km / (activity.durS / 3600))} km/h`);
  if (activity.hr) parts.push(`${activity.hr} bpm`);
  if (activity.dplus) parts.push(locale === "fr" ? `${Math.round(activity.dplus)} m D+` : `${Math.round(activity.dplus)} m gain`);
  if (activity.avgPower) parts.push(`${Math.round(activity.avgPower)} W`);
  if (activity.trainingLoad) parts.push(`${locale === "fr" ? "charge" : "load"} ${Math.round(activity.trainingLoad)}`);
  if (activity.kind === "run" && activity.aerobicTrainingEffect) parts.push(`${locale === "fr" ? "TE aéro" : "aerobic TE"} ${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }).format(activity.aerobicTrainingEffect)}`);
  return parts;
}

export function activityCoachComment(activity: TrailActivity, feedback?: TrailFeedback): string {
  if (feedback?.pain && feedback.pain > 3) return `Douleur ${feedback.pain}/10 : priorité à la récupération et pas de hausse de charge avant disparition à 24 h.`;
  if (feedback?.rpe && feedback.rpe >= 8) return `Effort élevé (${feedback.rpe}/10) : séance utile, mais protège la prochaine journée facile pour absorber la charge.`;
  if (activity.kind === "strength") return `Renforcement enregistré : il soutient la résistance en montée et en descente ; garde au moins 24 h avant la prochaine séance course exigeante.`;
  if (activity.kind === "ride") {
    if (activity.durS >= 5400) return `Bon volume aérobie sans impact : cette sortie vélo complète le plan, à condition de rester facile avant la prochaine séance clé.`;
    return `Vélo bien intégré comme complément : utile pour développer l’endurance sans ajouter les impacts d’une sortie course.`;
  }
  const zones = heartRateZoneDistribution(activity);
  if (zones) {
    if (zones.z2 >= 65) return `${zones.z2}% de la séance en Z2 : intensité bien maîtrisée et cohérente avec la construction d’endurance.`;
    if (zones.z3Plus !== null && zones.z3Plus > 35) return `${zones.z3Plus}% en Z3+ : séance réellement soutenue ; garde la prochaine facile si cette intensité n’était pas prévue.`;
    if (zones.z1 !== null && zones.z1 + zones.z2 >= 65) return `${zones.z1}% en Z1 et ${zones.z2}% en Z2 : séance facile, utile pour récupérer ou construire l’endurance sans surcharge.`;
    return `Répartition cardio : ${zones.z2}% en Z2. Croise-la avec la Z1, la Z3+ et ton ressenti avant de modifier la prochaine séance.`;
  }
  if (activity.aerobicTrainingEffect && activity.aerobicTrainingEffect >= 3.5) return `Stimulus aérobie marqué (${activity.aerobicTrainingEffect.toFixed(1).replace(".", ",")}) : bonne séance de développement, à faire suivre d’une récupération réelle.`;
  return `Séance enregistrée et intégrée au suivi ; ajoute ton ressenti pour affiner la prochaine adaptation du programme.`;
}

export function activityCoachAnalysis(activity: TrailActivity, feedback?: TrailFeedback): string[] {
  const notes = [activityCoachComment(activity, feedback)];

  if (activity.kind === "run") {
    const zones = heartRateZoneDistribution(activity);
    if (zones) notes.push(`Exécution : ${zones.z2}% en Z2${zones.z1 !== null ? ` · ${zones.z1}% en Z1` : ""}${zones.z3Plus !== null ? ` · ${zones.z3Plus}% en Z3+` : ""}${activity.hr ? ` · FC moyenne ${activity.hr} bpm` : ""}.`);
    else if (activity.hr) notes.push(`Exécution : FC moyenne ${activity.hr} bpm. Les temps par zone manquent encore pour juger précisément la maîtrise de l’intensité.`);

    if (activity.aerobicTrainingEffect !== null || activity.trainingLoad !== null) {
      notes.push(`Charge : ${activity.aerobicTrainingEffect !== null ? `effet aérobie ${activity.aerobicTrainingEffect.toFixed(1).replace(".", ",")}` : "effet aérobie non transmis"}${activity.trainingLoad !== null ? ` · charge Garmin ${Math.round(activity.trainingLoad)}` : ""}.`);
    }
  }

  if (feedback) {
    notes.push(feedback.pain > 3
      ? `Suite recommandée : récupération ou activité sans impact, puis nouvelle décision selon la douleur à 24 h.`
      : feedback.rpe >= 8
        ? "Suite recommandée : protéger au moins une journée facile pour assimiler cet effort."
        : "Suite recommandée : poursuivre le plan sans ajouter de volume non prévu, puis vérifier le ressenti le lendemain.");
  } else {
    notes.push("Action : renseigne RPE, douleur et ressenti ; ce feedback est nécessaire pour adapter la prochaine décision du coach.");
  }

  return notes.slice(0, 4);
}
