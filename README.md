# Bobiverse Companion

An unofficial, fan-made companion for Dennis E. Taylor’s Bobiverse novels.
This repo currently covers **books 1–2** only:

1. *We Are Legion (We Are Bob)* (2016)
2. *For We Are Many* (2017)

Later work will add a Bob family tree, interactive star map, timeline, character
& species guide, and a spoiler picker. This first pass is just the Astro app,
a basic landing page, and the shared data files.

**Not affiliated** with Dennis E. Taylor or his publishers.

## Stack

- [Astro](https://astro.build/) (static output)
- [Tailwind CSS](https://tailwindcss.com/) v4 via `@tailwindcss/vite`
- TypeScript

## Develop

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build    # production build → dist/
npm run preview  # serve the production build
npm run check    # astro check (types + Astro diagnostics)
```

## Data

Structured JSON for books 1–2 lives in [`src/data/`](src/data/):

| File | Contents |
| --- | --- |
| `books.json` | Covered novels |
| `bobs.json` | Replicant Bobs and lineage hints |
| `systems.json` | Star systems (with optional astrometry) |
| `events.json` | Timeline events |
| `characters.json` | Non-Bob characters |
| `species.json` | Species |
| `NOTES.md` | Conventions, uncertainties, and sources |
| `index.ts` | Typed exports + `isVisibleForBook()` helper |

Import from `src/data` (or `src/data/index.ts`) in Astro pages and components.
Use `firstBook` / `isVisibleForBook` so book-2 reveals stay hidden from book-1 readers.
