# Kinfold — cross-reference a person across WikiTree + Wikidata

A small research tool that takes one person and "digs deeper" by pulling their
record from **WikiTree** (open, collaborative tree) and **Wikidata** (structured
persons with dates, places, and kinship links), then lining the two up so you can
see what matches, what conflicts, and what only one source knows. **Open Archives**
adds free historical records as corroboration.

## Why there's a backend (and not just a webpage)

Neither API is ideal to call straight from the browser:

- **WikiTree** does not send permissive CORS headers. Its own example code notes
  `api.wikitree.com disallows cross-origin:*`, so a browser on any non-WikiTree
  domain gets blocked. Calling it **server-side** sidesteps CORS entirely.
- **Wikidata** requires a descriptive `User-Agent` on every request (Wikimedia
  policy; blank UAs get blocked). That's set server-side, and proxying keeps all
  external calls in one place.

So this app is a thin Node/Express backend that proxies the APIs and does the
fact reconciliation, with a static frontend that only ever talks to your backend.

```
browser ──▶ your Express backend ──▶ api.wikitree.com
                              ├────▶ wikidata.org (Action API)
                              └────▶ api.openarch.nl
```

## Prerequisites

- Node.js 18+ (uses the built-in global `fetch`)
- No API keys required — WikiTree (public profiles), Wikidata, and Open Archives
  all work without registration.

## Setup

**New to this? See [SETUP.md](SETUP.md) for a detailed, step-by-step walkthrough**
(installing Node, troubleshooting). The short version:

```bash
cp .env.example .env      # optional; sensible defaults work out of the box
npm install
npm start                 # http://localhost:3000
```

## Publishing it for others

To host a shared instance, see **[DEPLOY.md](DEPLOY.md)**. It covers a one-file
Render deploy (`render.yaml`), Docker, and production environment variables.
Because no source needs an API key, a public instance works with no approval step.

## .env

| Variable          | What it is                                                        |
|-------------------|-------------------------------------------------------------------|
| `PORT`            | Port for the local server (default 3000)                          |
| `SESSION_SECRET`  | Any random string; signs the session cookie                       |
| `WIKITREE_APP_ID` | A label identifying your app to WikiTree (no registration needed) |

## How to use it

1. Search a name (e.g. `Samuel Clemens`, optionally a birth year).
2. Pick a WikiTree match — you'll get a dossier: vitals, bio, parents, spouses.
3. Use **Auto-build** to climb the tree and match each person against Wikidata.
4. High-confidence matches merge automatically; uncertain ones become questions
   you answer in the Auto-build tab.

## What works

Working: WikiTree search, profile, relatives, ancestors; Wikidata person search +
fetch (no auth) with deterministic fact reconciliation; **Open Archives**
(openarch.nl) historical-record search in the Records tab — ~277M free
Dutch/Belgian/French records — plus a "find records for this person" handoff from
the dossier and paging through results.

The **Auto-build agent** (`server/agent/`) builds a tree from a seed WikiTree
person: it climbs the WikiTree skeleton and scores each person against
**Wikidata** with a deterministic confidence model (`scoring.js`). High-confidence
matches merge automatically; medium/conflicting ones become questions you answer
in the Auto-build tab. Every decision is explainable (name/date/place breakdown),
and name-only matches are never auto-merged. It also **corroborates each person
with Open Archives** records (evidence only — never merging identity or expanding
relationships, so it can't create false links): strong record matches add the
source, nudge confidence, and are written into the export. The assembled tree
exports as a **GEDCOM 5.5.1 file** (`agent/gedcom.js`) you can open in Ancestry,
Gramps, RootsMagic, etc., with source provenance, match confidence, and Open
Archives record citations written into record notes.

Extension points:
- The SPARQL endpoint for precise birth-year-filtered Wikidata queries
- Persisting agent trees (they currently live in server memory)

## Files

```
SETUP.md           Detailed local setup walkthrough
DEPLOY.md          How to publish a shared instance
Dockerfile         Container image for any container host
render.yaml        One-file Render deploy blueprint
server/
  index.js         Express app + routes
  wikitree.js      WikiTree API client (server-side, no CORS issue)
  wikidata.js      Wikidata client (no auth; descriptive User-Agent)
  openarchives.js  Open Archives client (no auth)
  agent/
    scoring.js     Deterministic match-confidence scoring (self-tested)
    engine.js      Tree state, expansion loop, questions
    gedcom.js      GEDCOM 5.5.1 export (self-tested)
public/
  index.html       Single-page UI
  styles.css       "Case-file" visual system
  app.js           Frontend logic (talks only to your backend)
```

## A note on data & privacy

WikiTree only returns **public** profiles through the API unless an authenticated
member is on a profile's trusted list. Wikidata is openly licensed (CC0). This
tool keeps state in a server session and doesn't persist record data to disk.
