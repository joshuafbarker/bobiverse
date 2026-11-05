/**
 * Typed loaders for the Bobiverse companion data (books 1–2 only).
 *
 * JSON lives next to this module and is imported at build time. Most entities
 * carry a `firstBook` field so the spoiler picker can hide book-2 reveals from
 * readers who have only finished book 1.
 */

import bobsJson from "./bobs.json";
import booksJson from "./books.json";
import charactersJson from "./characters.json";
import eventsJson from "./events.json";
import speciesJson from "./species.json";
import systemsJson from "./systems.json";

/** How sure we are about a fact drawn from the wiki / author chart. */
export type Confidence = "confirmed" | "uncertain";

/** Book number currently covered by this dataset (1 or 2). */
export type BookNumber = 1 | 2;

/** One published novel in the series. */
export interface Book {
  number: BookNumber;
  title: string;
  year: number;
  sources: string[];
}

/** A short note tied to the book where it first appears. */
export interface NotableNote {
  book: BookNumber;
  text: string;
}

/**
 * A Bob (replicant clone). The root Bob has `isRoot: true` and `parentId: null`.
 * When `parentKnown` is false, books 1–2 never establish the parent.
 */
export interface Bob {
  id: string;
  name: string;
  parentId: string | null;
  generation: number | null;
  firstBook: BookNumber;
  systems: string[];
  summary: string;
  /** Systems first tied to this Bob in book 2 (Bob already existed in book 1). */
  book2Systems: string[];
  notable: NotableNote[];
  parentKnown: boolean;
  parentSource: string;
  confidence: Confidence;
  sources: string[];
  /** Present only on the root Bob. */
  isRoot?: boolean;
  aliases?: string[];
  notes?: string[];
  book2Notes?: string[];
}

/** A named feature inside a star system (planet, station, etc.). */
export interface SystemFeature {
  name: string;
  firstBook: BookNumber;
  description: string;
}

/** Heliocentric galactic Cartesian coordinates in light-years. */
export interface GalacticXYZ {
  x: number;
  y: number;
  z: number;
}

/** A star system visited or referenced in books 1–2. */
export interface StarSystem {
  id: string;
  name: string;
  catalogName: string;
  distanceLy: number | null;
  raDeg: number | null;
  decDeg: number | null;
  galacticXYZly: GalacticXYZ | null;
  firstBook: BookNumber;
  description: string;
  features: SystemFeature[];
  bobsVisited: string[];
  confidence: Confidence;
  sources: string[];
  aliases?: string[];
  notes?: string[];
  book2Notes?: string[];
  astrometryRef?: string;
  parallaxMas?: number | null;
  parallaxErrMas?: number | null;
  distanceLyErr?: number | null;
}

/** A dated (or loosely dated) timeline event. */
export interface TimelineEvent {
  id: string;
  year: number;
  month: number | null;
  day: number | null;
  season: string | null;
  /** Sort key within the timeline. */
  order: number;
  title: string;
  description: string;
  firstBook: BookNumber;
  chapter: number | null;
  pov: string | null;
  bobsInvolved: string[];
  charactersInvolved: string[];
  speciesInvolved: string[];
  systemId: string | null;
  locationLabel: string | null;
  sources: string[];
  confidence: Confidence;
  notes?: string[];
}

/** A non-Bob character (human, Deltan, Pav, organization, etc.). */
export interface Character {
  id: string;
  name: string;
  type: string;
  firstBook: BookNumber;
  summary: string;
  confidence: Confidence;
  sources: string[];
  systemId?: string | null;
  speciesId?: string | null;
  aliases?: string[];
  notes?: string[];
  book2Notes?: string[];
}

/** An intelligent (or otherwise notable) species. */
export interface Species {
  id: string;
  name: string;
  homeSystemId: string | null;
  homeWorld: string | null;
  firstBook: BookNumber;
  summary: string;
  confidence: Confidence;
  sources: string[];
  notes?: string[];
  book2Notes?: string[];
}

/** Anything that reveals itself starting in a particular book. */
export interface SpoilerScoped {
  firstBook: BookNumber;
}

export const books = booksJson as Book[];
export const bobs = bobsJson as Bob[];
export const systems = systemsJson as StarSystem[];
export const events = eventsJson as TimelineEvent[];
export const characters = charactersJson as Character[];
export const species = speciesJson as Species[];

/**
 * Returns true when `item` is safe to show for a reader whose furthest
 * finished book is `selectedBook`. Book-1 readers only see `firstBook === 1`.
 */
export function isVisibleForBook(
  item: SpoilerScoped,
  selectedBook: BookNumber,
): boolean {
  return item.firstBook <= selectedBook;
}

/**
 * Count how many items in `items` first appear in each covered book.
 * Useful for spoiler-safe at-a-glance stats on the landing page.
 */
export function countByFirstBook<T extends SpoilerScoped>(
  items: T[],
): Record<BookNumber, number> {
  const counts: Record<BookNumber, number> = { 1: 0, 2: 0 };
  for (const item of items) {
    counts[item.firstBook] += 1;
  }
  return counts;
}
