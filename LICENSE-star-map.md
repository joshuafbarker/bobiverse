# Star map license (CC BY-SA 4.0)

The interactive star map on this site — including the canvas renderer in
`src/scripts/star-map-engine.ts`, the related page chrome in
`src/pages/star-map.astro`, and map-oriented data adapted into
`src/data/travels.json`, `src/data/mapPresence.json`, and
`src/data/mapEvents.json` — is licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).

## Attribution

This work is **adapted** from:

- **[thunfischtoast/bobiverse-map](https://github.com/thunfischtoast/bobiverse-map)**  
  Copyright (c) 2026 Chris  
  Original license: CC BY-SA 4.0

### Changes from the original

- Ported into this Astro site as a TypeScript module with a build-time data adapter
- Limited to books 1–2 (this companion’s scope)
- Book spoiler level uses the site’s `bobiverse-book` BookToggle
- Added system selection info panel (distance, description, Bobs present)
- Added Sol light-year distance rings
- Star coordinates / descriptions come from this companion’s `systems.json`
  (catalog astrometry); travel legs, presence years, event-log lines, and the
  spread layout positions are adapted from the reference dataset
- Map-only group marker `loki-plus-4` and `elmer-2` retained for strike-force
  visualization; site-wide Bob records remain in `bobs.json`

The rest of this repository (pages other than the star map, shared layout, and
non-map datasets) is **not** relicensed by this file unless separately noted.
