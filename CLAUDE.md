# CLAUDE.md — project context for Claude Code

Kinfold is a cross-source genealogy app: it takes a person and combines **WikiTree**,
**Wikidata**, and **Open Archives** to reconcile facts, search records, and
auto-build a family tree, exporting to GEDCOM. This file orients you (Claude Code)
before you make changes.

## Run / test

- Start: `npm start` → http://localhost:3000  (Node 18+, ESM, `"type":"module"`)
- Install deps: `npm install`
- Syntax-check after edits: `node --check <file>` for every JS file you touch.
- This repo has **no test runner**; verify logic with throwaway ESM scripts
  (`node ./_tmp.mjs`) that import a module and assert on output, then delete them.
  See the pattern used for `server/agent/scoring.js` and `server/agent/gedcom.js`.
- There is no network in some sandboxes; pure functions (scoring, gedcom, date
  parsing) must be testable without network. Keep them pure.

## Architecture

```
server/
  index.js         Express app + all routes; sessions via express-session
  wikitree.js      WikiTree client (server-side; the API blocks browser CORS)
  wikidata.js      Wikidata client (no auth; descriptive User-Agent required)
  openarchives.js  Open Archives client (no auth)
  agent/
    scoring.js     Deterministic match-confidence scoring (pure, self-tested)
    engine.js      Tree state, BFS expansion loop, questions, source matching
    gedcom.js      GEDCOM 5.5.1 export (pure, self-tested)
public/
  index.html       Single page: tabs = Cross-reference / Record search / Auto-build
  styles.css       "Case-file" visual system; CSS variables at :root
  app.js           Frontend; talks ONLY to our backend, never directly to APIs
```

Why a backend at all: WikiTree blocks cross-origin browser calls and Wikidata
requires a descriptive server-side User-Agent, so every external API is proxied
server-side.

## Conventions (follow these)

- **ESM only**, Node global `fetch` (no node-fetch). Dependencies are intentionally
  minimal: express, express-session, dotenv. Don't add libraries without reason.
- **Every data source exposes the same flattened person shape** so the rest of the
  app stays source-agnostic:
  `{ name, firstName, lastName, gender, birthDate, deathDate, birthPlace, deathPlace, url }`
  (records add `eventType/eventDate/eventPlace/sourceType/archive`). When adding a
  source, mirror `wikidata.js` / `openarchives.js`.
- **Matching is deterministic, never an LLM.** `scoring.js` returns a 0..1 score +
  tier (high/medium/low) + breakdown. The agent auto-merges only `high` and never
  auto-merges a name-only match — preserve these safeguards. Wrong merges corrupt
  the tree, so precision beats recall.
- **The agent asks rather than guesses.** Medium/conflicting matches become
  questions (`engine.js` → `askConfirmMatch`), answered via `/api/agent/answer`.
- **Sources are additive and gated.** Open Archives is corroboration only (it never
  merges identity or expands relationships). Each source has a cfg flag
  (`useOpenArchives`, etc.) and is wrapped in try/catch so one failing source can't
  break a run.
- **Honesty about uncertainty.** Surface confidence in the UI and in GEDCOM notes;
  don't present a guess as a fact.
- **Formatting:** keep prose in the UI minimal; the visual system lives in
  `styles.css` via CSS variables — reuse them, don't hardcode new colors except a
  single per-source accent.

## Source colors (UI)

WikiTree = slate `--wikitree`; Open Archives = teal `--records`;
Wikidata = plum `--wikidata`. New sources get one new accent color.

## Routes (server/index.js)

- WikiTree: `/api/wikitree/search|profile/:key|ancestors/:key`
- Open Archives: `/api/openarchives/search`
- Agent: `/api/agent/start|continue|answer|tree|gedcom`

## Deploy

See `DEPLOY.md`. Sessions are in-memory (lost on restart); agent trees live in
server memory keyed by `session.treeId`. Production sets `NODE_ENV=production`
(secure cookies + proxy trust).

## Sources

WikiTree is the structural skeleton; **Wikidata** is the no-auth cross-source
matcher (deterministic scoring, auto-merge only on high confidence); **Open
Archives** is corroboration only. All three need no API key.
