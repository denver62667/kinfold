// server/index.js
import "dotenv/config";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as wikitree from "./wikitree.js";
import * as wikidata from "./wikidata.js";
import * as openarch from "./openarchives.js";
import * as europeana from "./europeana.js";
import * as agent from "./agent/engine.js";
import { treeToGedcom } from "./agent/gedcom.js";
import { reconcile } from "./crossref.js";
import { scoreMatch, scoreRecord } from "./agent/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  // Behind a platform load balancer (Render, Fly, etc.) TLS terminates at the
  // edge; trusting the proxy lets secure cookies work over the HTTPS frontend.
  app.set("trust proxy", 1);
  if (!process.env.SESSION_SECRET) {
    console.warn("WARNING: SESSION_SECRET is not set in production. Set it to a long random string.");
  }
}

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",        // allows the cookie to survive the OAuth redirect
      secure: isProd,          // HTTPS-only in production
      maxAge: 1000 * 60 * 60 * 12 // 12h
    }
  })
);
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check for hosting platforms.
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Small helper to keep route handlers tidy.
const wrap = (handler) => (req, res) =>
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error(err);
    res.status(502).json({ error: err.message });
  });

// --- cross-reference helpers ---
const yr = (d) => { const m = String(d || "").match(/\b(\d{4})\b/); return m ? m[1] : ""; };
const firstPlaceToken = (p) => (p ? p.split(",")[0].trim() : "");
const factCount = (c) => ["birthDate", "deathDate", "birthPlace", "deathPlace"].filter((k) => c[k]).length;
const flatWd = (c) => ({
  name: c.name, birthDate: c.birthDate, deathDate: c.deathDate,
  birthPlace: c.birthPlace, deathPlace: c.deathPlace, url: c.url, qid: c.qid
});

// Pull corroborating records for a person from Open Archives (+ Europeana when a
// key is set), score each against the person, and return the strongest few.
async function gatherRecords(wt) {
  const name = [wt.firstName, wt.lastName].filter(Boolean).join(" ");
  if (!name) return [];
  const out = [];
  try {
    const { results } = await openarch.searchRecords({ name, eventplace: firstPlaceToken(wt.birthPlace), count: 8 });
    for (const r of results || []) out.push({ ...r, source: "openarchives", score: scoreRecord(wt, r) });
  } catch (e) { console.error("crossref openarchives:", e.message); }
  if (europeana.hasKey()) {
    try {
      const { results } = await europeana.searchRecords({ name, count: 8 });
      for (const r of results || []) out.push({ ...r, source: "europeana", score: scoreRecord(wt, r) });
    } catch (e) { console.error("crossref europeana:", e.message); }
  }
  return out
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }));
}

// ---------- WikiTree ----------

app.get("/api/wikitree/search", wrap(async (req, res) => {
  const { firstName = "", lastName = "", birthDate = "", deathDate = "" } = req.query;
  const matches = await wikitree.searchPerson({ firstName, lastName, birthDate, deathDate });
  res.json({ matches });
}));

app.get("/api/wikitree/profile/:key", wrap(async (req, res) => {
  const [profile, relatives] = await Promise.all([
    wikitree.getProfile(req.params.key),
    wikitree.getRelatives(req.params.key).catch(() => null)
  ]);
  res.json({ profile, relatives });
}));

app.get("/api/wikitree/ancestors/:key", wrap(async (req, res) => {
  const depth = Math.min(Number(req.query.depth) || 4, 7);
  res.json({ ancestors: await wikitree.getAncestors(req.params.key, depth) });
}));

// Open Archives search (no auth — free Dutch/Belgian/French records aggregator).
app.get("/api/openarchives/search", wrap(async (req, res) => {
  const { given = "", surname = "", place = "", start = "0", count = "20" } = req.query;
  const name = [given, surname].map((s) => s.trim()).filter(Boolean).join(" ");
  if (!name) return res.status(400).json({ error: "A name is required to search Open Archives." });
  const data = await openarch.searchRecords({
    name,
    eventplace: place,
    start: Number(start) || 0,
    count: Math.min(Number(count) || 20, 100)
  });
  res.json(data);
}));

// Europeana search (free API key — pan-European archives incl. UK & Germany).
app.get("/api/europeana/search", wrap(async (req, res) => {
  if (!europeana.hasKey()) {
    return res.status(503).json({
      error: "Europeana is not configured. Set EUROPEANA_API_KEY (free at https://pro.europeana.eu/get-api)."
    });
  }
  const { given = "", surname = "", place = "", country = "", start = "0", count = "20" } = req.query;
  const name = [given, surname].map((s) => s.trim()).filter(Boolean).join(" ");
  if (!name) return res.status(400).json({ error: "A name is required to search Europeana." });
  const data = await europeana.searchRecords({
    name,
    place,
    country,
    start: Number(start) || 0,
    count: Math.min(Number(count) || 20, 100)
  });
  res.json(data);
}));

// Which optional, key-gated sources are available (lets the UI hide what's off).
app.get("/api/sources", (req, res) => {
  res.json({ europeana: europeana.hasKey() });
});

// Cross-reference one person across ALL sources at once: WikiTree (the subject) is
// reconciled fact-by-fact against the best Wikidata match, and corroborated with
// Open Archives (+ Europeana when configured). Powers the "dig deeper" dossier so a
// search isn't WikiTree-only. Every source is wrapped so one failure can't break it.
app.post("/api/crossref", wrap(async (req, res) => {
  const { wikitreeKey } = req.body;
  if (!wikitreeKey) return res.status(400).json({ error: "wikitreeKey is required" });

  const wt = await wikitree.getProfile(wikitreeKey); // throws if not found

  let wikidataMatch = null, match = null, reconciliation = null;
  try {
    const candidates = await wikidata.searchPersons({
      given: wt.firstName, surname: wt.lastName,
      birth: yr(wt.birthDate), death: yr(wt.deathDate)
    });
    const scored = (candidates || [])
      .map((c) => ({ c, ...scoreMatch(wt, c) }))
      .sort((a, b) => b.score - a.score);
    // Among candidates whose score essentially ties the top, prefer the one with
    // the most populated facts — avoids surfacing a name-only stub over the real,
    // date-and-place-rich entity (e.g. picking the full person, not a bare label).
    const top = scored[0];
    const best = top
      ? scored
          .filter((s) => s.score >= top.score - 0.03)
          .sort((a, b) => factCount(b.c) - factCount(a.c))[0]
      : null;
    // Show the best plausible match (medium+ or a name/date conflict worth seeing).
    if (best && (best.tier === "high" || best.tier === "medium" || best.conflict)) {
      wikidataMatch = flatWd(best.c);
      match = { score: best.score, tier: best.tier, conflict: best.conflict, breakdown: best.breakdown };
      reconciliation = reconcile(wt, best.c);
    }
  } catch (e) {
    console.error("crossref wikidata:", e.message);
  }

  const records = await gatherRecords(wt);

  res.json({ wikitree: wt, wikidata: wikidataMatch, match, reconciliation, records });
}));

// ---------- Tree-building agent ----------

app.post("/api/agent/start", wrap(async (req, res) => {
  const { wikitreeKey, settings } = req.body;
  if (!wikitreeKey) return res.status(400).json({ error: "wikitreeKey is required" });
  const tree = await agent.createTree(wikitreeKey, settings || {});
  req.session.treeId = tree.id;
  await agent.run(tree);
  res.json(agent.snapshot(tree));
}));

app.post("/api/agent/continue", wrap(async (req, res) => {
  const tree = agent.getTree(req.session.treeId);
  if (!tree) return res.status(404).json({ error: "No active tree. Start one first." });
  await agent.run(tree);
  res.json(agent.snapshot(tree));
}));

app.post("/api/agent/answer", wrap(async (req, res) => {
  const tree = agent.getTree(req.session.treeId);
  if (!tree) return res.status(404).json({ error: "No active tree." });
  const { questionId, value } = req.body;
  agent.answerQuestion(tree, questionId, value);
  res.json(agent.snapshot(tree));
}));

app.get("/api/agent/tree", wrap(async (req, res) => {
  const tree = agent.getTree(req.session.treeId);
  res.json(tree ? agent.snapshot(tree) : null);
}));

// Download the current agent tree as a GEDCOM 5.5.1 file.
app.get("/api/agent/gedcom", wrap(async (req, res) => {
  const tree = agent.getTree(req.session.treeId);
  if (!tree) return res.status(404).send("No active tree. Build one first.");
  const ged = treeToGedcom(tree, { submitter: "Kinfold" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="kinfold-tree.ged"');
  res.send(ged);
}));

app.listen(PORT, () => {
  console.log(`Kinfold running at http://localhost:${PORT}`);
});
