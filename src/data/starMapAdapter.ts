/**
 * Build-time adapter: companion `src/data` → payload shape expected by the
 * canvas star-map engine (adapted from thunfischtoast/bobiverse-map).
 *
 * Travel legs, map presence, and short event-log lines in travels.json /
 * mapPresence.json / mapEvents.json are adapted from that repo under
 * CC BY-SA 4.0 (see LICENSE-star-map.md). System descriptions and site Bob
 * records remain this project's own data.
 */
import { bobs, systems, type BookNumber } from "./index";
import travelsFile from "./travels.json";
import presenceFile from "./mapPresence.json";
import mapEventsFile from "./mapEvents.json";

interface PresenceRow {
  bobId: string;
  created: number;
  at: string;
  destroyed: number | null;
  firstBook: number;
  refName?: string;
  group?: number;
  mapOnly?: boolean;
  notes?: string;
}

interface TravelRow {
  bobId: string;
  fromSystemId: string;
  toSystemId: string;
  departYear: number;
  arriveYear: number;
  firstBook: number;
}

interface MapEventRow {
  year: number;
  text: string;
  bobId: string | null;
  firstBook: number;
  destroyed?: boolean;
}

const presenceJson = presenceFile as { presence: PresenceRow[] };
const travelsJson = travelsFile as { travels: TravelRow[] };
const mapEventsJson = mapEventsFile as { events: MapEventRow[] };

export interface StarMapStar {
  id: string;
  name: string;
  /** Right ascension in hours (for realistic projection). */
  raHours: number;
  decDeg: number;
  distanceLy: number;
  firstBook: BookNumber;
  description: string;
}

export interface StarMapBob {
  id: string;
  name: string;
  gen: number | null;
  parentId: string | null;
  created: number;
  at: string;
  destroyed: number | null;
  firstBook: BookNumber;
  group?: number;
  mapOnly?: boolean;
}

export interface StarMapTravel {
  bobId: string;
  from: string;
  to: string;
  depart: number;
  arrive: number;
  firstBook: BookNumber;
}

export interface StarMapEvent {
  year: number;
  text: string;
  bobId: string | null;
  firstBook: BookNumber;
  destroyed?: boolean;
}

export interface LegendBranch {
  id: string;
  name: string;
  color: string;
  firstBook: BookNumber;
}

export interface StarMapPayload {
  stars: Record<string, StarMapStar>;
  bobs: Record<string, StarMapBob>;
  travels: StarMapTravel[];
  events: StarMapEvent[];
  /** Hand-tuned 0–1 positions for "spread" layout (from reference map). */
  customLayout: Record<string, { x: number; y: number }>;
  /** Major lineage heads for the on-map legend (build-time markup). */
  legendBranches: LegendBranch[];
  yearMin: number;
  yearMax: number;
}

/** Spread layout copied from thunfischtoast/bobiverse-map (CC BY-SA 4.0), remapped to our ids. */
const CUSTOM_LAYOUT: Record<string, { x: number; y: number }> = {
  sol: { x: 0.5, y: 0.12 },
  "epsilon-eridani": { x: 0.42, y: 0.32 },
  "delta-eridani": { x: 0.58, y: 0.42 },
  "omicron2-eridani": { x: 0.3, y: 0.48 },
  "alpha-centauri": { x: 0.72, y: 0.2 },
  "82-eridani": { x: 0.22, y: 0.68 },
  "beta-hydri": { x: 0.12, y: 0.85 },
  "epsilon-indi": { x: 0.82, y: 0.35 },
  "eta-cassiopeiae": { x: 0.88, y: 0.08 },
  "kappa-ceti": { x: 0.62, y: 0.14 },
  "gamma-leporis": { x: 0.35, y: 0.58 },
  "gliese-877": { x: 0.08, y: 0.55 },
  "gliese-54": { x: 0.15, y: 0.4 },
  "delta-pavonis": { x: 0.78, y: 0.72 },
  "gamma-pavonis": { x: 0.88, y: 0.6 },
  "hip-14101": { x: 0.48, y: 0.58 },
  "hip-84051": { x: 0.75, y: 0.88 },
  "zeta-tucanae": { x: 0.05, y: 0.72 },
  "pi3-orionis": { x: 0.52, y: 0.72 },
};

const bobById = Object.fromEntries(bobs.map((b) => [b.id, b]));

export function buildStarMapPayload(): StarMapPayload {
  const stars: Record<string, StarMapStar> = {};
  for (const system of systems) {
    if (!system.galacticXYZly || system.distanceLy == null) continue; // skip NN 4285
    const raDeg = system.raDeg ?? 0;
    const decDeg = system.decDeg ?? 0;
    stars[system.id] = {
      id: system.id,
      name: system.name,
      raHours: raDeg / 15,
      decDeg,
      distanceLy: system.distanceLy,
      firstBook: system.firstBook,
      description: system.description,
    };
  }

  const bobsOut: Record<string, StarMapBob> = {};
  for (const row of presenceJson.presence) {
    const siteBob = bobById[row.bobId];
    const name =
      row.bobId === "loki-plus-4"
        ? "Loki +4"
        : row.bobId === "elmer-2"
          ? "Elmer"
          : (siteBob?.name ?? row.refName ?? row.bobId);
    bobsOut[row.bobId] = {
      id: row.bobId,
      name,
      gen: siteBob?.generation ?? null,
      parentId: siteBob?.parentId ?? null,
      created: row.created,
      at: row.at,
      destroyed: row.destroyed,
      firstBook: row.firstBook as BookNumber,
      group: row.group,
      mapOnly: row.mapOnly,
    };
  }

  const travels: StarMapTravel[] = travelsJson.travels.map((t) => ({
    bobId: t.bobId,
    from: t.fromSystemId,
    to: t.toSystemId,
    depart: t.departYear,
    arrive: t.arriveYear,
    firstBook: t.firstBook as BookNumber,
  }));

  const events: StarMapEvent[] = mapEventsJson.events
    .map((e) => ({
      year: e.year,
      text: e.text,
      bobId: e.bobId,
      firstBook: e.firstBook as BookNumber,
      destroyed: e.destroyed || undefined,
    }))
    .sort((a, b) => a.year - b.year || a.text.localeCompare(b.text));

  /** Branch head colors from the reference map (CC BY-SA). */
  const BRANCH_HUES: Record<string, [number, number, number]> = {
    bob: [45, 90, 75],
    bill: [210, 70, 65],
    riker: [150, 60, 60],
    milo: [280, 55, 65],
    mario: [20, 75, 65],
  };
  const legendBranches: LegendBranch[] = (["bob", "bill", "riker", "milo", "mario"] as const)
    .filter((id) => bobsOut[id])
    .map((id) => {
      const [h, s, l] = BRANCH_HUES[id];
      return {
        id,
        name: bobsOut[id].name,
        color: `hsl(${h} ${s}% ${l}%)`,
        firstBook: bobsOut[id].firstBook,
      };
    });

  return {
    stars,
    bobs: bobsOut,
    travels,
    events,
    customLayout: CUSTOM_LAYOUT,
    legendBranches,
    yearMin: 2133,
    yearMax: 2221,
  };
}
