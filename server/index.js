// server/index.js
import "dotenv/config";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as wikitree from "./wikitree.js";
import * as openarch from "./openarchives.js";
import * as agent from "./agent/engine.js";
import { treeToGedcom } from "./agent/gedcom.js";

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
