/**
 * Build-time Bob location timeline for the star map.
 *
 * Physical presence is inferred carefully: `bobsInvolved` also lists Bobs who
 * are only mentioned or present via SCUT, so we do NOT move every involved Bob
 * to event.systemId.
 *
 * Rules:
 * 1. POV Bob with a plottable systemId is treated as being there that year.
 * 2. Creation wording places newly named Bobs at the event system.
 * 3. Departure is detected only with a Name+(leaves for|heads to|…) pattern
 *    (or "Name … depart" in the title). Destination is parsed from that same
 *    clause when possible. Bender → Gamma Leporis stays in transit.
 * 4. In-transit Bobs arrive when placed at their destination (POV / co-arrival
 *    / matching transit target).
 * 5. POV at a new system with no dated leave → locationJump.
 * 6. Bobs with no POV/creation trail are seeded at systems[0] on their first
 *    involving event year (documented heuristic).
 * 7. NN 4285 is never used. Years before MAP_YEAR_MIN are skipped.
 */

import { bobs, events, systems, type BookNumber, type TimelineEvent } from "./index";

export interface BobLocationSegment {
  bobId: string;
  bobName: string;
  systemId: string | null;
  fromYear: number;
  toYear: number | null;
  firstBook: BookNumber;
  status: "present" | "transit";
  fromSystemId?: string;
  toSystemId?: string;
  locationJump?: boolean;
  notes?: string;
}

export const MAP_YEAR_MIN = 2133;
export const MAP_YEAR_MAX = 2221;

const POV_ALIASES: Record<string, string> = {
  "original bob": "bob",
};

const NAMED_DESTINATIONS: Array<[RegExp, string]> = [
  [/pi\s*³\s*orionis|pi3\s*orionis|π³\s*orionis/i, "pi3-orionis"],
  [/gamma\s+leporis/i, "gamma-leporis"],
  [/kappa\s+ceti/i, "kappa-ceti"],
  [/82\s*eridani/i, "82-eridani"],
  [/omicron\s*²\s*eridani|omicron2\s*eridani/i, "omicron2-eridani"],
  [/epsilon\s+indi/i, "epsilon-indi"],
  [/epsilon\s+eridani/i, "epsilon-eridani"],
  [/delta\s+eridani/i, "delta-eridani"],
  [/alpha\s+centauri/i, "alpha-centauri"],
  [/eta\s+cassiopeiae|poseidon/i, "eta-cassiopeiae"],
  [/hip\s*14101/i, "hip-14101"],
  [/gl(?:iese)?\s*877/i, "gliese-877"],
  [/gl(?:iese)?\s*54\b/i, "gliese-54"],
  [/delta\s+pavonis/i, "delta-pavonis"],
  [/gamma\s+pavonis/i, "gamma-pavonis"],
  [/\b(sol|earth)\b/i, "sol"],
];

/** Verbs that mean this Bob is traveling, kept tight to the name. */
const LEAVE_VERB =
  "(?:leaves? for|leaves\\b|leaving for|departs?\\b|departed\\b|heads? out to|heads? to|heading (?:back |out )?to)";

function bobIdFromPov(pov: string | null): string | null {
  if (!pov) return null;
  const alias = POV_ALIASES[pov.toLowerCase()];
  if (alias) return alias;
  const byName = bobs.find((b) => b.name.toLowerCase() === pov.toLowerCase());
  if (byName) return byName.id;
  return bobs.find((b) => b.id === pov.toLowerCase())?.id ?? null;
}

function eventSortKey(event: TimelineEvent): [number, number, number, number] {
  return [event.year, event.month ?? 0, event.day ?? 0, event.order];
}

function isPlottableSystem(systemId: string | null | undefined): systemId is string {
  if (!systemId) return false;
  return systems.some((s) => s.id === systemId && s.galacticXYZly != null);
}

function bobNameOf(id: string): string {
  return bobs.find((b) => b.id === id)?.name ?? id;
}

function bobBook(id: string): BookNumber {
  return bobs.find((b) => b.id === id)?.firstBook ?? 1;
}

function matchDestinationPhrase(phrase: string): string | null {
  for (const [pattern, systemId] of NAMED_DESTINATIONS) {
    if (pattern.test(phrase) && isPlottableSystem(systemId)) return systemId;
  }
  return null;
}

/**
 * Detect travelers with a name-local leave verb. Creation titles are ignored.
 * "Bob told to leave" and stay-behind clauses are excluded.
 */
function isBobDeparting(bobId: string, event: TimelineEvent): boolean {
  const bob = bobs.find((b) => b.id === bobId);
  if (!bob || !event.bobsInvolved.includes(bobId)) return false;
  // Combined titles like "Garfield and Homer created; Riker leaves for Sol"
  // still need departure detection for the travelers — only skip if THIS Bob
  // is the one being created in the title.
  if (bobsCreatedInEvent(event).includes(bobId) && !new RegExp(`\\b${bob.name}\\b.{0,40}${LEAVE_VERB}`, "i").test(event.title)) {
    return false;
  }

  const text = `${event.title} ${event.description}`;
  if (new RegExp(`\\b${bob.name}\\b.{0,40}told to leave\\b`, "i").test(text)) {
    return false;
  }

  // "Name leaves for X" / "Name heads out to X" within a short span (no other clause).
  const local = new RegExp(`\\b${bob.name}\\b(?:'s clone)?\\s+${LEAVE_VERB}`, "i");
  if (local.test(text)) return true;

  // "Name and Y leave/depart" or "Name and his clone Y leave"
  const pair = new RegExp(
    `\\b${bob.name}\\b(?:\\s+and\\s+(?:his clone\\s+)?[A-Z][a-z]+)?\\s+${LEAVE_VERB}`,
    "i",
  );
  if (pair.test(text)) return true;

  // Title: "Luke and Bender depart" / "Riker leaves for Sol"
  if (
    new RegExp(`\\b${bob.name}\\b`, "i").test(event.title) &&
    /\b(leaves?|leaving|departs?|departed)\b/i.test(event.title)
  ) {
    return true;
  }

  return false;
}

function inferDestination(bobId: string, event: TimelineEvent): string | null {
  const bob = bobs.find((b) => b.id === bobId);
  if (!bob) return null;
  const text = `${event.title} ${event.description}`;

  // Capture "Name heads out to DEST" / "Name leaves for DEST" directly.
  const direct = new RegExp(
    `\\b${bob.name}\\b(?:'s clone)?\\s+${LEAVE_VERB}\\s+([^.,;]+?)(?=\\s+and\\s+[A-Z]|[.,;]|$)`,
    "i",
  );
  const hit = text.match(direct);
  if (hit) {
    const dest = matchDestinationPhrase(hit[1]);
    if (dest) return dest;
  }

  // Pair form: "Riker and his clone Homer leave heading back to Earth"
  const pair = new RegExp(
    `\\b${bob.name}\\b(?:\\s+and\\s+(?:his clone\\s+)?[A-Z][a-z]+)?\\s+${LEAVE_VERB}\\s+([^.,;]+)`,
    "i",
  );
  const pairHit = text.match(pair);
  if (pairHit) {
    const dest = matchDestinationPhrase(pairHit[1]);
    if (dest) return dest;
  }

  // Title-only: "Riker leaves for Sol"
  const titleHit = event.title.match(
    new RegExp(`\\b${bob.name}\\b.{0,40}${LEAVE_VERB}\\s+([^.,;]+)`, "i"),
  );
  if (titleHit) {
    const dest = matchDestinationPhrase(titleHit[1]);
    if (dest) return dest;
  }

  return null;
}

function bobsCreatedInEvent(event: TimelineEvent): string[] {
  if (!/\b(created|clones?:|first clones|activated)\b/i.test(event.title)) return [];
  const created: string[] = [];
  for (const bob of bobs) {
    if (!event.bobsInvolved.includes(bob.id)) continue;
    if (!new RegExp(`\\b${bob.name}\\b`, "i").test(event.title)) continue;
    if (bobIdFromPov(event.pov) === bob.id && !/\bactivated\b/i.test(event.title)) continue;
    created.push(bob.id);
  }
  return created;
}

function isTitledCoArrival(event: TimelineEvent): boolean {
  if (/\breport reaches\b/i.test(event.title)) return false;
  return /\breach(?:es|ed)?\b|\barriv(?:e|es|ed|al)\b/i.test(event.title);
}

export function buildBobLocationSegments(): BobLocationSegment[] {
  const sorted = [...events].sort((a, b) => {
    const ka = eventSortKey(a);
    const kb = eventSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3] - kb[3];
  });

  const openIndex = new Map<string, number>();
  const segments: BobLocationSegment[] = [];

  function closeOpen(bobId: string, atYear: number) {
    const idx = openIndex.get(bobId);
    if (idx === undefined) return;
    const segment = segments[idx];
    if (segment.toYear == null) segment.toYear = Math.max(segment.fromYear, atYear);
    openIndex.delete(bobId);
  }

  function openPresent(
    bobId: string,
    systemId: string,
    year: number,
    firstBook: BookNumber,
    extras: Partial<BobLocationSegment> = {},
  ) {
    const currentIdx = openIndex.get(bobId);
    if (currentIdx !== undefined) {
      const current = segments[currentIdx];
      if (current.status === "present" && current.systemId === systemId) return;
    }
    closeOpen(bobId, year);
    segments.push({
      bobId,
      bobName: bobNameOf(bobId),
      systemId,
      fromYear: Math.max(year, MAP_YEAR_MIN),
      toYear: null,
      firstBook: Math.max(firstBook, bobBook(bobId)) as BookNumber,
      status: "present",
      ...extras,
    });
    openIndex.set(bobId, segments.length - 1);
  }

  function openTransit(
    bobId: string,
    fromSystemId: string,
    toSystemId: string | null,
    year: number,
    firstBook: BookNumber,
  ) {
    const currentIdx = openIndex.get(bobId);
    if (currentIdx !== undefined) {
      const current = segments[currentIdx];
      if (
        current.status === "transit" &&
        current.fromSystemId === fromSystemId &&
        (current.toSystemId ?? null) === toSystemId
      ) {
        return;
      }
    }
    closeOpen(bobId, year);
    segments.push({
      bobId,
      bobName: bobNameOf(bobId),
      systemId: null,
      fromSystemId,
      toSystemId: toSystemId ?? undefined,
      fromYear: Math.max(year, MAP_YEAR_MIN),
      toYear: null,
      firstBook: Math.max(firstBook, bobBook(bobId)) as BookNumber,
      status: "transit",
      notes:
        toSystemId === "gamma-leporis"
          ? "Bender's destination only; arrival unconfirmed in books 1–2."
          : toSystemId
            ? undefined
            : "Departure dated; destination/arrival not fixed in books 1–2 data.",
    });
    openIndex.set(bobId, segments.length - 1);
  }

  for (const event of sorted) {
    if (event.year < MAP_YEAR_MIN) continue;
    const year = event.year;
    const departing = bobs.filter((b) => isBobDeparting(b.id, event)).map((b) => b.id);

    for (const bobId of departing) {
      const openIdx = openIndex.get(bobId);
      const current = openIdx !== undefined ? segments[openIdx] : undefined;
      const fromSystem =
        current?.status === "present" && current.systemId
          ? current.systemId
          : isPlottableSystem(event.systemId)
            ? event.systemId
            : null;
      if (!fromSystem) continue;
      openTransit(bobId, fromSystem, inferDestination(bobId, event), year, event.firstBook);
    }

    if (!isPlottableSystem(event.systemId)) continue;
    const systemId = event.systemId;
    const toPlace = new Set<string>();
    const povId = bobIdFromPov(event.pov);

    if (povId && !departing.includes(povId)) toPlace.add(povId);
    for (const bobId of bobsCreatedInEvent(event)) {
      if (!departing.includes(bobId)) toPlace.add(bobId);
    }
    for (const [bobId, idx] of openIndex) {
      const segment = segments[idx];
      if (segment.status === "transit" && segment.toSystemId === systemId) {
        toPlace.add(bobId);
      }
    }
    if (isTitledCoArrival(event)) {
      for (const bob of bobs) {
        if (
          event.bobsInvolved.includes(bob.id) &&
          new RegExp(`\\b${bob.name}\\b`, "i").test(event.title) &&
          !departing.includes(bob.id)
        ) {
          toPlace.add(bob.id);
        }
      }
    }

    // Battles name everyone present; SCUT guests are rare in these rows.
    if (/\bbattle\b/i.test(event.title)) {
      for (const bobId of event.bobsInvolved) {
        if (!departing.includes(bobId)) toPlace.add(bobId);
      }
    }

    for (const bobId of toPlace) {
      const openIdx = openIndex.get(bobId);
      const current = openIdx !== undefined ? segments[openIdx] : undefined;
      if (!current) {
        openPresent(bobId, systemId, year, event.firstBook);
        continue;
      }
      if (current.status === "transit") {
        current.toYear = year;
        if (!current.toSystemId) current.toSystemId = systemId;
        openPresent(bobId, systemId, year, event.firstBook);
        continue;
      }
      if (current.systemId === systemId) continue;
      openPresent(bobId, systemId, year, event.firstBook, { locationJump: true });
    }
  }

  for (const bob of bobs) {
    if (segments.some((s) => s.bobId === bob.id)) continue;
    const home = bob.systems.find((id) => isPlottableSystem(id));
    if (!home) continue;
    const firstEvent = sorted.find(
      (event) => event.year >= MAP_YEAR_MIN && event.bobsInvolved.includes(bob.id),
    );
    openPresent(bob.id, home, firstEvent?.year ?? MAP_YEAR_MIN, bob.firstBook, {
      notes: "Seeded at first listed system on earliest involving event; no POV trail in data.",
    });
  }

  for (const bobId of [...openIndex.keys()]) {
    const idx = openIndex.get(bobId)!;
    if (segments[idx].toYear == null) segments[idx].toYear = MAP_YEAR_MAX + 1;
  }

  return segments.filter((segment) => segment.toYear == null || segment.toYear > segment.fromYear);
}

export const bobLocationSegments = buildBobLocationSegments();
export const plottableSystems = systems.filter((s) => s.galacticXYZly != null);
export const unplottableSystems = systems.filter((s) => s.galacticXYZly == null);
