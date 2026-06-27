# CLAUDE.md — project context for Claude Code

Kinfold is a **document-first genealogy search**. The premise: you already know who
you're looking for. Kinfold takes a name (plus optional place / year range) and fans
out across free, no-login archives of **documents and references about people** —
newspapers, vital records, and digitized histories — surfacing material that might
tell you something *new*. It deliberately is **not** a lineage/tree database like
WikiTree or FamilySearch; it competes with them from the document side. This file
orients you (Claude Code) before you make changes.

## Run / test

- Start: `npm start` → http://localhost:3000  (Node 18+, ESM, `"type":"module"`)
- Install deps: `npm install` (only `express` + `dotenv`)
- Syntax-check after edits: `node --check <file>` for every JS file you touch.
- This repo has **no test runner**; verify logic with throwaway ESM scripts
  (`node ./_tmp.mjs`) that import a module and assert on output, then delete them.
  Use this for `server/scoring.js` and each source's exported `flatten()` mapper.
- **Network matters:** some sandboxes block all outbound HTTP (the source clients then
  return per-source errors — which is the designed behavior). Keep all parsing and
  scoring **pure** so they're testable against fixture JSON without network.

## Architecture

```
server/
  index.js              Express app. Two routes: /api/sources and /api/search.
  scoring.js            Deterministic record-relevance scoring (pure, self-tested).
  sources/
    index.js            Source registry — the single place sources are declared.
    openarchives.js     Open Archives client (NL/BE/FR vital records; no auth).
    chroniclingamerica.js  Library of Congress historic newspapers (no auth).
    internetarchive.js  archive.org digitized texts/genealogies (no auth).
public/
  index.html       Single search view (name-led form + source toggles + results).
  styles.css       "Case-file" visual system; CSS variables at :root.
  app.js           Frontend; talks ONLY to our backend, never directly to archives.
```

Why a backend at all: archives ask for a descriptive server-side User-Agent and the
browser would otherwise hit CORS/rate-limit walls, so every external API is proxied
server-side. `GET /api/search` fans out to the chosen sources **in parallel**, scores
every returned record for relevance, and returns results **grouped per source** with
isolated error reporting (one failing source can't break the response).

## Conventions (follow these)

- **ESM only**, Node global `fetch` (no node-fetch). Dependencies are intentionally
  minimal: `express`, `dotenv`. Don't add libraries without reason.
- **Every source exposes the same contract**, so the rest of the app stays
  source-agnostic. A source module exports:
  `searchRecords({ name, place, fromYear, toYear, start, count }) → { total, results }`
  and each result is the flattened record shape:
  `{ name, role, eventType, eventDate, eventPlace, sourceType, archive, snippet, url }`
  (`snippet` is an OCR/description excerpt for document sources). To add a source:
  write the module, then register it in `server/sources/index.js` with
  `{ id, label, accent, region, description, search }`. Mirror an existing source.
- **No API keys.** Every source is free and no-auth. If a future source needs a key,
  gate it so the app still runs without it (and hide it in `/api/sources`).
- **Scoring ranks, it never asserts.** `scoring.js → scoreRecord(query, rec)` returns a
  0..1 relevance used only to order/surface records. A record is **evidence for the
  user to weigh**, not a verified fact and never an identity merge. Be honest about
  uncertainty in the UI ("X% match", "evidence to weigh").
- **Sources are additive and isolated.** Each source call in `/api/search` is wrapped
  in try/catch; a failure returns `{ error }` for that group only.
- **Formatting:** keep UI prose minimal; the visual system lives in `styles.css` via
  CSS variables — reuse them. Each source gets exactly one accent color.

## Source accents (UI)

Open Archives = teal `--records`; Chronicling America = burnt sienna `--news`;
Internet Archive = slate blue `--texts`. A new source gets one new accent; wire it via
the `accent` field in the registry and an `.acc-<name>` / `.record-card.acc-<name>`
block in `styles.css`.

## Routes (server/index.js)

- `GET /api/sources` → `{ sources: [{ id, label, accent, region, description }] }`
  (the UI builds its source toggles from this).
- `GET /api/search?given=&surname=&name=&place=&from=&to=&sources=&count=&start=`
  → `{ query, groups: [{ source, label, accent, total, results[], error? }] }`.
  `sources` is a CSV of ids (default: all). Results are scored and sorted desc.

## Deploy

See `DEPLOY.md`. The app is **stateless** — no sessions, no database, no per-user
server state — so it scales trivially and restarts cleanly. Production sets
`NODE_ENV=production` (trusts the platform proxy).

## Sources

All three are free and need no key. **Open Archives** (openarch.nl) — NL/BE/FR vital
records (births, baptisms, marriages, deaths), the primary documents. **Chronicling
America** (Library of Congress) — full-text historic US newspapers, where a name
search turns up notices, obituaries, and mentions. **Internet Archive** (archive.org)
— digitized published genealogies, family/local histories, and biographical works
that *reference* people. The source layer is pluggable; add more name-searchable
document sources the same way.
