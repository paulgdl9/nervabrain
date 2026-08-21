export type EnduranceSport = "run" | "trail" | "ride";

export type EnduranceEvent = {
  id: string;
  sport: EnduranceSport;
  name: string;
  date: string;
  distanceKm: number;
  elevationM: number;
  location: { fr: string; en: string };
  sourceUrl: string;
};

// A small, versioned catalog beats a brittle race-site scraper. Each edition
// below was checked against the organizer's official page on 2026-07-16.
export const ENDURANCE_EVENT_CATALOG_VERSION = "2026-07-16";

export const ENDURANCE_EVENTS: readonly EnduranceEvent[] = [
  {
    id: "berlin-marathon-2026",
    sport: "run",
    name: "BMW Berlin Marathon 2026",
    date: "2026-09-27",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "Berlin, Allemagne", en: "Berlin, Germany" },
    sourceUrl: "https://www.bmw-berlin-marathon.com/en/registration/registration-information",
  },
  {
    id: "new-york-marathon-2026",
    sport: "run",
    name: "TCS New York City Marathon 2026",
    date: "2026-11-01",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "New York, États-Unis", en: "New York, United States" },
    sourceUrl: "https://www.nyrr.org/tcsnycmarathon",
  },
  {
    id: "chicago-marathon-2026",
    sport: "run",
    name: "Bank of America Chicago Marathon 2026",
    date: "2026-10-11",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "Chicago, États-Unis", en: "Chicago, United States" },
    sourceUrl: "https://www.chicagomarathon.com/runners/runner-information/",
  },
  {
    id: "chicago-5k-2026",
    sport: "run",
    name: "Abbott Chicago 5K 2026",
    date: "2026-10-10",
    distanceKm: 5,
    elevationM: 0,
    location: { fr: "Chicago, États-Unis", en: "Chicago, United States" },
    sourceUrl: "https://www.chicagomarathon.com/runners/runner-information/",
  },
  {
    id: "athens-marathon-2026",
    sport: "run",
    name: "Athens Marathon — The Authentic 2026",
    date: "2026-11-08",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "Marathon → Athènes, Grèce", en: "Marathon → Athens, Greece" },
    sourceUrl: "https://www.athensauthenticmarathon.gr/en/c/agones-2-26/authentic-marathon-1/marathonios-dromos-33",
  },
  {
    id: "athens-10k-2026",
    sport: "run",
    name: "Athens 10K 2026",
    date: "2026-11-08",
    distanceKm: 10,
    elevationM: 0,
    location: { fr: "Athènes, Grèce", en: "Athens, Greece" },
    sourceUrl: "https://www.athensauthenticmarathon.gr/en/c/agones-26",
  },
  {
    id: "athens-5k-2026",
    sport: "run",
    name: "Athens 5K 2026",
    date: "2026-11-07",
    distanceKm: 5,
    elevationM: 0,
    location: { fr: "Athènes, Grèce", en: "Athens, Greece" },
    sourceUrl: "https://www.athensauthenticmarathon.gr/en/c/agones-26",
  },
  {
    id: "la-rochelle-marathon-2026",
    sport: "run",
    name: "Marathon de La Rochelle Serge Vigot 2026",
    date: "2026-11-29",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "La Rochelle, France", en: "La Rochelle, France" },
    sourceUrl: "https://marathondelarochelle.com/",
  },
  {
    id: "valencia-marathon-2026",
    sport: "run",
    name: "Valencia Marathon 2026",
    date: "2026-12-06",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "Valence, Espagne", en: "Valencia, Spain" },
    sourceUrl: "https://www.valenciaciudaddelrunning.com/en/marathon/presentation/",
  },
  {
    id: "london-marathon-2027",
    sport: "run",
    name: "TCS London Marathon 2027",
    date: "2027-04-25",
    distanceKm: 42.195,
    elevationM: 0,
    location: { fr: "Londres, Royaume-Uni", en: "London, United Kingdom" },
    sourceUrl: "https://www.londonmarathonevents.co.uk/london-marathon/article/announcing-2027-tcs-london-marathon-double-two-days-one-event-100000-people",
  },
  {
    id: "occ-2026",
    sport: "trail",
    name: "OCC 2026",
    date: "2026-08-27",
    distanceKm: 60,
    elevationM: 3500,
    location: { fr: "Orsières → Chamonix", en: "Orsières → Chamonix" },
    sourceUrl: "https://montblanc.utmb.world/fr/races/OCC",
  },
  {
    id: "ccc-2026",
    sport: "trail",
    name: "CCC 2026",
    date: "2026-08-28",
    distanceKm: 101,
    elevationM: 6050,
    location: { fr: "Courmayeur → Chamonix", en: "Courmayeur → Chamonix" },
    sourceUrl: "https://montblanc.utmb.world/fr/races/CCC",
  },
  {
    id: "utmb-2026",
    sport: "trail",
    name: "UTMB 2026",
    date: "2026-08-28",
    distanceKm: 174,
    elevationM: 9900,
    location: { fr: "Chamonix · tour du Mont-Blanc", en: "Chamonix · Mont-Blanc loop" },
    sourceUrl: "https://montblanc.utmb.world/fr/races/UTMB",
  },
  {
    id: "tds-2026",
    sport: "trail",
    name: "TDS 2026",
    date: "2026-08-24",
    distanceKm: 145,
    elevationM: 9500,
    location: { fr: "Courmayeur → Chamonix", en: "Courmayeur → Chamonix" },
    sourceUrl: "https://montblanc.utmb.world/fr/races/TDS",
  },
  {
    id: "grindstone-100m-2026",
    sport: "trail",
    name: "Grindstone by UTMB 100M 2026",
    date: "2026-09-18",
    distanceKm: 167.4,
    elevationM: 6400,
    location: { fr: "Virginie, États-Unis", en: "Virginia, United States" },
    sourceUrl: "https://grindstone.utmb.world/",
  },
  {
    id: "grindstone-100k-2026",
    sport: "trail",
    name: "Grindstone by UTMB 100K 2026",
    date: "2026-09-19",
    distanceKm: 99.9,
    elevationM: 3350,
    location: { fr: "Virginie, États-Unis", en: "Virginia, United States" },
    sourceUrl: "https://grindstone.utmb.world/",
  },
  {
    id: "grindstone-50k-2026",
    sport: "trail",
    name: "Grindstone by UTMB 50K 2026",
    date: "2026-09-19",
    distanceKm: 49.9,
    elevationM: 1550,
    location: { fr: "Virginie, États-Unis", en: "Virginia, United States" },
    sourceUrl: "https://grindstone.utmb.world/",
  },
  {
    id: "templiers-vo2-2026",
    sport: "trail",
    name: "VO2 Trail des Templiers 2026",
    date: "2026-10-17",
    distanceKm: 17.1,
    elevationM: 695,
    location: { fr: "Millau, France", en: "Millau, France" },
    sourceUrl: "https://www.festivaldestempliers.com/vo2-trail/",
  },
  {
    id: "templiers-monna-lisa-2026",
    sport: "trail",
    name: "Monna Lisa Trail 2026",
    date: "2026-10-17",
    distanceKm: 30,
    elevationM: 1175,
    location: { fr: "Millau, France", en: "Millau, France" },
    sourceUrl: "https://www.festivaldestempliers.com/la-monna-lisa-trail/",
  },
  {
    id: "grand-trail-templiers-2026",
    sport: "trail",
    name: "Grand Trail des Templiers 2026",
    date: "2026-10-18",
    distanceKm: 80.7,
    elevationM: 3443,
    location: { fr: "Millau, France", en: "Millau, France" },
    sourceUrl: "https://www.festivaldestempliers.com/grand-trail-des-templiers/",
  },
  {
    id: "diagonale-des-fous-2026",
    sport: "trail",
    name: "Diagonale des Fous 2026",
    date: "2026-10-15",
    distanceKm: 175,
    elevationM: 10500,
    location: { fr: "La Réunion, France", en: "Réunion Island, France" },
    sourceUrl: "https://www.grandraid-reunion.com/fr/accueil/actualites/1924",
  },
  {
    id: "saintelyon-2026",
    sport: "trail",
    name: "Asics SaintéLyon 2026",
    date: "2026-11-28",
    distanceKm: 80,
    elevationM: 2000,
    location: { fr: "Saint-Étienne → Lyon", en: "Saint-Étienne → Lyon" },
    sourceUrl: "https://www.saintelyon.com/races/80km-saintelyon",
  },
  {
    id: "etape-du-tour-2026",
    sport: "ride",
    name: "L’Étape du Tour de France 2026",
    date: "2026-07-19",
    distanceKm: 170,
    elevationM: 5400,
    location: { fr: "Bourg-d’Oisans → Alpe d’Huez", en: "Bourg-d’Oisans → Alpe d’Huez" },
    sourceUrl: "https://www.letapedutourdefrance.com/fr/la-course/parcours",
  },
  {
    id: "gfny-villavicencio-2027",
    sport: "ride",
    name: "GFNY Villavicencio 2027",
    date: "2027-04-25",
    distanceKm: 109,
    elevationM: 1308,
    location: { fr: "Villavicencio, Colombie", en: "Villavicencio, Colombia" },
    sourceUrl: "https://gfny.com/gfny-is-back-in-colombia/",
  },
  {
    id: "maratona-dolomites-2027",
    sport: "ride",
    name: "Maratona dles Dolomites 2027",
    date: "2027-07-04",
    distanceKm: 138,
    elevationM: 4230,
    location: { fr: "Alta Badia, Italie", en: "Alta Badia, Italy" },
    sourceUrl: "https://www.maratona.it/en/138km",
  },
] as const;

export function eventsForSport(sport: EnduranceSport, today = "0000-01-01") {
  return ENDURANCE_EVENTS.filter((event) => event.sport === sport && event.date >= today);
}

export function trainingPlanStartISO(eventDate: string, weeksTotal: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !Number.isInteger(weeksTotal) || weeksTotal < 1 || weeksTotal > 52) return "";
  const date = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== eventDate) return "";
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1 - (weeksTotal - 1) * 7);
  return date.toISOString().slice(0, 10);
}

export function trainingWeeksAvailable(eventDate: string, today: string): number {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
  };
  const event = parse(eventDate);
  const current = parse(today);
  if (!event || !current || event < current) return 0;
  const monday = (date: Date) => {
    const copy = new Date(date);
    copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
    return copy;
  };
  const weeks = Math.floor((monday(event).getTime() - monday(current).getTime()) / 604_800_000) + 1;
  return Math.max(1, Math.min(52, weeks));
}

export type TrainingExperience = "first" | "shorter" | "similar" | "several";

const EXPERIENCE_LABELS: Record<TrainingExperience, string> = {
  first: "aucune épreuve terminée",
  shorter: "une épreuve plus courte terminée",
  similar: "une épreuve comparable terminée",
  several: "plusieurs épreuves comparables terminées",
};

export function trainingLevelSummary({
  weeklyVolumeKm,
  sessionsPerWeek,
  longestSessionKm,
  experience,
  recentReference,
}: {
  weeklyVolumeKm: number;
  sessionsPerWeek: number;
  longestSessionKm: number;
  experience: TrainingExperience;
  recentReference?: string;
}) {
  return [
    `${weeklyVolumeKm} km/semaine`,
    `${sessionsPerWeek} séance${sessionsPerWeek > 1 ? "s" : ""}/semaine`,
    `sortie la plus longue ${longestSessionKm} km`,
    EXPERIENCE_LABELS[experience],
    recentReference?.trim() ? `référence récente : ${recentReference.trim()}` : "",
  ].filter(Boolean).join(" · ");
}
