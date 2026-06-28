// server/index.js
// Express app for Kinfold — a document-first people search. One job: take a name
// (the user already knows who they're looking for) and fan out across free, no-auth
// document/record archives in parallel, surfacing references that might reveal
// something new. No tree-building, no lineage, no curated database — documents only.
//
// Every external API is proxied server-side: some (Open Archives) ask for a
// descriptive User-Agent, and proxying keeps the browser off cross-origin calls and
// out of rate-limit/CORS trouble.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listSources, getSource, isAvailable, availableSources } from "./sources/index.js";
import { scoreRecord } from "./scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

if (isProd) app.set("trust proxy", 1); // behind a platform load balancer (Render, Fly…)

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check for hosting platforms.
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Keep route handlers tidy; surface a clean 502 on unexpected failure.
const wrap = (handler) => (req, res) =>
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error(err);
    res.status(502).json({ error: err.message });
  });

// Which sources exist (the UI builds its toggles from this). All are no-auth/free,
// so all are always available.
app.get("/api/sources", (req, res) => {
  res.json({ sources: listSources() });
});

// Unified search. Fans out to the selected sources in parallel; each is isolated so
// one failing or slow source can't sink the others. Every record is scored for
// relevance to the query and the strongest are returned per source.
//
// Query: name (required), given, surname, place, from, to (years),
//        sources (csv of ids; default all), count, start.
app.get("/api/search", wrap(async (req, res) => {
  const given = (req.query.given || "").trim();
  const surname = (req.query.surname || "").trim();
  const name = (req.query.name || [given, surname].filter(Boolean).join(" ")).trim();
  if (!name) return res.status(400).json({ error: "A name is required to search." });

  const place = (req.query.place || "").trim();
  const fromYear = (req.query.from || "").trim();
  const toYear = (req.query.to || "").trim();
  const count = Math.min(Number(req.query.count) || 20, 50);
  const start = Math.max(Number(req.query.start) || 0, 0);

  const query = { name, firstName: given, lastName: surname, place, fromYear, toYear };

  const requested = (req.query.sources || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  // Explicit selection is honored but still gated on availability (a key-gated
  // source with no key is skipped rather than erroring); default is everything usable.
  const chosen = requested.length
    ? requested.map(getSource).filter((s) => s && isAvailable(s))
    : availableSources();

  const groups = await Promise.all(
    chosen.map(async (src) => {
      try {
        const { total, results } = await src.search({ name, place, fromYear, toYear, start, count });
        const scored = (results || [])
          .map((r) => ({ ...r, source: src.id, score: scoreRecord(query, r) }))
          .sort((a, b) => b.score - a.score);
        return { source: src.id, label: src.label, accent: src.accent, total: total || scored.length, results: scored };
      } catch (e) {
        console.error(`search ${src.id}:`, e.message);
        return { source: src.id, label: src.label, accent: src.accent, total: 0, results: [], error: e.message };
      }
    })
  );

  res.json({ query: { name, place, fromYear, toYear, start, count }, groups });
}));

app.listen(PORT, () => {
  console.log(`Kinfold running at http://localhost:${PORT}`);
});
