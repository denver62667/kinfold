# Kinfold — document-first genealogy search

You already know who you're looking for. **Kinfold** takes a name (plus optional
place and year range) and searches free, no-login archives of **documents and
references about people** — historic newspapers, vital records, and digitized
histories — all at once, surfacing material that might tell you something *new*.

It is deliberately **not** a lineage/tree database like WikiTree or FamilySearch.
Those hand you a curated tree; Kinfold hands you the underlying documents and lets
you judge them. Records are presented as **evidence to weigh**, never as verified
facts.

## Sources

Most are free and **need no API key**. Two (DPLA, Trove) use a free key and stay
hidden until you set it — the app runs fine without them.

| Source | What it holds | Region | Key |
|---|---|---|---|
| **Open Archives** (openarch.nl) | Vital records — births, baptisms, marriages, deaths | Netherlands · Belgium · France | — |
| **Chronicling America** (Library of Congress) | Full-text historic newspapers — notices, obituaries, mentions | United States · 1756–1963 | — |
| **Internet Archive** (archive.org) | Digitized published genealogies, family & local histories, biographical works, directories | Worldwide | — |
| **Library of Congress** (loc.gov) | Photographs, manuscripts, city directories, printed works | United States · broad | — |
| **National Archives UK** (Discovery) | ~35M archival descriptions — wills, military, court, prison, immigration | UK · Commonwealth | — |
| **Digital Repository of Ireland** (dri.ie) | Irish archival collections — letters, photos, parish & institutional records, oral histories | Ireland | — |
| **DPLA** (dp.la) | 50M+ items from US libraries, archives & museums | United States · aggregated | free key |
| **Trove** (nla.gov.au) | Digitised newspapers & gazettes | Australia · NZ | free key |

The source layer is pluggable — adding another name-searchable document source is a
single module plus one registry entry (see `server/sources/`). Key-gated sources
declare an `available()` predicate so they're hidden from `/api/sources` until their
key is set.

## Why there's a backend (and not just a webpage)

These archives are awkward to call straight from the browser: some require a
descriptive `User-Agent`, and browsers hit CORS / rate-limit walls. So Kinfold is a
thin Node/Express backend that proxies the APIs, scores results for relevance, and
serves a static frontend that only ever talks to your backend.

```
browser ──▶ your Express backend ──▶ api.openarch.nl
                              ├────▶ chroniclingamerica.loc.gov
                              └────▶ archive.org
```

`GET /api/search` fans out to every chosen source **in parallel**; each is isolated,
so one slow or failing source can't sink the rest.

## Prerequisites

- Node.js 18+ (uses the built-in global `fetch`)
- **No API keys, no accounts.** Every source is free and anonymous.

## Setup

**New to this? See [SETUP.md](SETUP.md)** for a step-by-step walkthrough. The short
version:

```bash
cp .env.example .env      # optional; defaults work out of the box
npm install               # only express + dotenv
npm start                 # http://localhost:3000
```

## How to use it

1. Enter a name — at least a surname. Optionally add a place and a year range
   (the years you know your person lived within).
2. Tick the sources you want, then **Search archives**.
3. Results default to **Best matches** — one list merged across every source and
   ranked by relevance, each card tagged with where it came from. When the same
   person turns up in several sources, the records **collapse into one card** (the
   strongest is the face; the rest fold into an "also found in…" expander). Flip to
   **By source** to see everything grouped per archive with per-source counts.
4. Drag **min relevance** to hide weak matches; the count and both views update live.
5. Each card carries a relevance score and, where available, a snippet (newspaper
   OCR, book description); follow **View source** to the original document.
6. **Export CSV** saves your findings (ranked, source-tagged, threshold-respecting)
   as a research log.

## Publishing it for others

See **[DEPLOY.md](DEPLOY.md)** — a one-file Render deploy (`render.yaml`), Docker, and
production notes. The app is **stateless** (no sessions, no database), so a public
instance needs no secrets and restarts cleanly.

## .env

| Variable        | What it is                                                          |
|-----------------|---------------------------------------------------------------------|
| `PORT`          | Port for the local server (default 3000)                            |
| `NODE_ENV`      | Set to `production` behind a platform load balancer                 |
| `DPLA_API_KEY`  | *Optional, free.* Enables the DPLA source. Hidden until set.        |
| `TROVE_API_KEY` | *Optional, free.* Enables the Trove source. Hidden until set.       |

(The six core sources need no keys; the two optional keys above just unlock extra sources.)

## How it's built

- **`server/sources/`** — one client per source, all exposing the same
  `searchRecords({ name, place, fromYear, toYear, start, count })` contract and the
  same flattened record shape, declared in `server/sources/index.js`.
- **`server/scoring.js`** — pure, deterministic `scoreRecord(query, rec)`: name
  similarity (Dice bigrams + whole-word containment) plus optional year-range and
  place signals. It only *ranks* records; it never asserts identity.
- **`server/index.js`** — `/api/sources` and `/api/search`. Stateless.
- **`public/`** — single search view; `app.js` talks only to the backend.

## Files

```
SETUP.md                       Detailed local setup walkthrough
DEPLOY.md                      How to publish a shared instance
Dockerfile                     Container image for any container host
render.yaml                    One-file Render deploy blueprint
server/
  index.js                     Express app + routes (/api/sources, /api/search)
  scoring.js                   Deterministic record-relevance scoring (self-tested)
  sources/
    index.js                   Source registry
    openarchives.js            Open Archives client (no auth)
    chroniclingamerica.js      Library of Congress newspapers (no auth)
    internetarchive.js         Internet Archive texts (no auth)
public/
  index.html                   Single-page search UI
  styles.css                   "Case-file" visual system
  app.js                       Frontend logic (talks only to your backend)
```

## A note on data & privacy

Every source is public and openly searchable. Kinfold holds **no per-user state** —
no login, no session, no database — and never persists record data to disk; results
live only in your browser until you export them.
