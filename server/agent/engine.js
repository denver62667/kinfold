// server/agent/engine.js
// The tree-building agent. WikiTree provides the structural skeleton (its curated
// parent/spouse/child links); Wikidata corroborates each person's identity
// across sources via deterministic scoring. High-confidence matches merge
// automatically; ambiguous ones become questions for the user.
//
// Trees live in server memory, keyed by id (a session holds its treeId). Lost on
// restart — same tradeoff as our sessions; swap in a store to persist.

import * as wikitree from "../wikitree.js";
import * as openarch from "../openarchives.js";
import * as wikidata from "../wikidata.js";
import { scoreMatch, scoreRecord } from "./scoring.js";

const trees = new Map();
let seq = 1;
const newId = (p) => `${p}${seq++}`;

const DEFAULTS = {
  maxGenerations: 3, // how many ancestor generations to climb
  perRunBudget: 6, // nodes processed per run() call (bounds API calls)
  maxPersons: 80, // hard ceiling so a run can't explode
  useOpenArchives: true, // corroborate each person with Open Archives records
  useWikidata: true // cross-source match against Wikidata (no auth required)
};

// Relations whose relatives we keep expanding (the ancestor line). Spouses and
// children of the seed are added and matched, but not climbed further, to keep
// the tree a clean pedigree plus the seed's immediate family.
const ANCESTOR_RELS = new Set(["self", "father", "mother", "parent"]);

export async function createTree(seedKey, settings = {}) {
  const cfg = { ...DEFAULTS, ...settings };
  cfg.maxGenerations = Math.min(Math.max(Number(cfg.maxGenerations) || 3, 1), 6);

  const profile = await wikitree.getProfile(seedKey); // throws if not found
  const tree = {
    id: newId("tree-"),
    seedKey,
    cfg,
    persons: new Map(),
    byWikitree: new Map(),
    frontier: [],
    questions: [],
    log: [],
    status: "running",
    createdAt: Date.now()
  };
  const root = makeNode(tree, profile, { relation: "self", generation: 0 });
  tree.rootId = root.id;
  enqueue(tree, root);
  trees.set(tree.id, tree);
  log(tree, `Started from ${root.name || seedKey}`);
  return tree;
}

export function getTree(id) {
  return trees.get(id);
}

// Process the work queue up to a budget, calling out to the data sources.
export async function run(tree, budget = null) {
  const limit = budget || tree.cfg.perRunBudget;
  let processed = 0;
  while (tree.frontier.length && processed < limit && tree.persons.size < tree.cfg.maxPersons) {
    const node = tree.persons.get(tree.frontier.shift());
    if (!node || node.expanded) continue;
    await processNode(tree, node);
    processed++;
  }
  tree.status = tree.frontier.length
    ? "running"
    : tree.questions.length
      ? "waiting"
      : "done";
  return tree;
}

async function processNode(tree, node) {
  node.expanded = true;

  // 1. Cross-source identity check against Wikidata (no auth needed).
  if (tree.cfg.useWikidata && !node.wdChecked && node.lastName) {
    node.wdChecked = true;
    try {
      const candidates = await wikidata.searchPersons({
        given: node.firstName,
        surname: node.lastName,
        birth: yearStr(node.birthDate),
        death: yearStr(node.deathDate)
      });
      evaluateWdCandidates(tree, node, candidates);
    } catch (e) {
      log(tree, `Wikidata lookup failed for ${node.name}: ${e.message}`);
    }
  }

  // 2. Corroborate with Open Archives records (no auth). Evidence only — never
  // merges identity or expands relationships, so it can't create false links.
  if (tree.cfg.useOpenArchives && !node.oaChecked && node.lastName) {
    node.oaChecked = true;
    try {
      const { results } = await openarch.searchRecords({
        name: [node.firstName, node.lastName].filter(Boolean).join(" "),
        eventplace: firstPlaceToken(node.birthPlace),
        count: 10
      });
      const scored = (results || [])
        .map((r) => ({ ...r, score: scoreRecord(node, r) }))
        .filter((r) => r.score >= 0.6)
        .sort((a, b) => b.score - a.score);

      if (scored.length) {
        node.records = scored.slice(0, 5).map((r) => ({
          name: r.name,
          eventType: r.eventType,
          eventDate: r.eventDate,
          eventPlace: r.eventPlace,
          sourceType: r.sourceType,
          archive: r.archive,
          url: r.url,
          score: Math.round(r.score * 100) / 100
        }));
        node.recordCount = scored.length;
        // A strong record corroborates identity: add the source and nudge confidence.
        if (scored[0].score >= 0.78) {
          if (!node.sources.includes("openarchives")) node.sources.push("openarchives");
          node.confidence = Math.min(1, node.confidence + 0.03);
          log(tree, `Open Archives corroborates ${node.name} (${node.recordCount} record${node.recordCount > 1 ? "s" : ""})`);
        }
      }
    } catch (e) {
      log(tree, `Open Archives lookup failed for ${node.name}: ${e.message}`);
    }
  }

  // 3. Expand the WikiTree skeleton along the ancestor line.
  if (node.wikitreeId && ANCESTOR_RELS.has(node.relation) && node.generation < tree.cfg.maxGenerations) {
    try {
      const rel = await wikitree.getRelatives(node.wikitreeId);
      expandRelatives(tree, node, rel);
    } catch (e) {
      log(tree, `WikiTree relatives failed for ${node.name}: ${e.message}`);
    }
  }
}

function expandRelatives(tree, node, rel) {
  for (const p of rel.parents || []) {
    const relation = p.gender === "Male" ? "father" : p.gender === "Female" ? "mother" : "parent";
    const parent = addRelative(tree, p, relation, node.generation + 1, node.id);
    link(node, parent, "parent");
    enqueue(tree, parent);
  }

  // Seed's own spouses and children round out the immediate family.
  if (node.relation === "self") {
    for (const s of rel.spouses || []) {
      const sp = addRelative(tree, s, "spouse", node.generation, node.id);
      link(node, sp, "spouse");
      enqueue(tree, sp); // matched against Wikidata, but not climbed
    }
    for (const c of rel.children || []) {
      const ch = addRelative(tree, c, "child", node.generation - 1, node.id);
      link(node, ch, "child");
      enqueue(tree, ch);
    }
  }
}

function evaluateWdCandidates(tree, node, candidates) {
  if (!candidates || !candidates.length) return;
  const scored = candidates
    .map((c) => ({ c, ...scoreMatch(node, c) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  node.matchScore = best.score;

  if (best.tier === "high" && !best.conflict) {
    attachWikidata(node, best.c, best.score);
    log(tree, `Auto-matched ${node.name} to Wikidata (confidence ${best.score})`);
    return;
  }
  if (best.tier === "medium" || best.conflict) {
    askConfirmMatch(tree, node, best, scored[1], "wikidata");
  }
  // tier "low": no plausible Wikidata match — leave as-is.
}

function askConfirmMatch(tree, node, best, runner, source = "wikidata") {
  const closeRunner =
    runner && runner.score >= best.score - 0.08 ? flatCandidate(runner.c) : null;
  tree.questions.push({
    id: newId("q-"),
    nodeId: node.id,
    kind: "confirm-match",
    source,
    prompt: best.conflict
      ? "Names match but the dates look off. Same person?"
      : "Is this the same person across both sources?",
    person: summarize(node),
    candidate: flatCandidate(best.c),
    runnerUp: closeRunner,
    score: best.score,
    conflict: best.conflict,
    breakdown: best.breakdown,
    options: [
      { label: "Yes, same person", value: "yes" },
      { label: "No, different person", value: "no" },
      { label: "Skip for now", value: "skip" }
    ],
    payload: { candidate: best.c }
  });
  log(tree, `Need your call on ${node.name} (score ${best.score})`);
}

export function answerQuestion(tree, questionId, value) {
  const idx = tree.questions.findIndex((q) => q.id === questionId);
  if (idx < 0) return tree;
  const q = tree.questions[idx];
  const node = tree.persons.get(q.nodeId);

  if (q.kind === "confirm-match" && value === "yes" && node) {
    attachWikidata(node, q.payload.candidate, q.score);
    log(tree, `You confirmed ${node.name} across sources (Wikidata)`);
  } else if (value === "no" && node) {
    node.matchScore = null;
    log(tree, `You marked the candidate as a different person from ${node.name}`);
  } // "skip": leave the question's subject untouched

  tree.questions.splice(idx, 1);
  tree.status = tree.frontier.length ? "running" : tree.questions.length ? "waiting" : "done";
  return tree;
}

// ---------- node helpers ----------

function makeNode(tree, profile, { relation, generation, fromId = null }) {
  if (profile.wikitreeId && tree.byWikitree.has(profile.wikitreeId)) {
    return tree.persons.get(tree.byWikitree.get(profile.wikitreeId));
  }
  const node = {
    id: newId("p-"),
    wikitreeId: profile.wikitreeId || null,
    name: profile.name || "",
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    gender: profile.gender || "",
    birthDate: profile.birthDate || "",
    deathDate: profile.deathDate || "",
    birthPlace: profile.birthPlace || "",
    deathPlace: profile.deathPlace || "",
    url: profile.url || "",
    wikidataUrl: "",
    wikidataQid: null,
    sources: profile.wikitreeId ? ["wikitree"] : [],
    confidence: relation === "self" ? 1 : 0.9, // a curated WikiTree link is trusted
    matchScore: null,
    relation,
    generation,
    fromId,
    parentIds: [],
    spouseIds: [],
    childIds: [],
    expanded: false,
    wdChecked: false,
    oaChecked: false,
    records: [],
    recordCount: 0
  };
  tree.persons.set(node.id, node);
  if (node.wikitreeId) tree.byWikitree.set(node.wikitreeId, node.id);
  return node;
}

function addRelative(tree, profile, relation, generation, fromId) {
  return makeNode(tree, profile, { relation, generation, fromId });
}

function link(a, b, type) {
  const push = (arr, id) => { if (!arr.includes(id)) arr.push(id); };
  if (type === "parent") { push(a.parentIds, b.id); push(b.childIds, a.id); }
  if (type === "spouse") { push(a.spouseIds, b.id); push(b.spouseIds, a.id); }
  if (type === "child") { push(a.childIds, b.id); push(b.parentIds, a.id); }
}

function enqueue(tree, node) {
  if (!node.expanded && !tree.frontier.includes(node.id)) tree.frontier.push(node.id);
}

function attachWikidata(node, c, score) {
  node.wikidataQid = c.qid || null;
  node.wikidataUrl = c.url || "";
  if (!node.sources.includes("wikidata")) node.sources.push("wikidata");
  node.matchScore = score;
  node.confidence = Math.max(node.confidence, score);
  node.birthDate = node.birthDate || c.birthDate || "";
  node.deathDate = node.deathDate || c.deathDate || "";
  node.birthPlace = node.birthPlace || c.birthPlace || "";
  node.deathPlace = node.deathPlace || c.deathPlace || "";
  if (!node.name) node.name = c.name || "";
}

// ---------- serialization for the API ----------

export function snapshot(tree) {
  const persons = [...tree.persons.values()];
  return {
    id: tree.id,
    status: tree.status,
    seedKey: tree.seedKey,
    rootId: tree.rootId,
    cfg: tree.cfg,
    counts: {
      persons: persons.length,
      matched: persons.filter((n) => n.sources.includes("wikidata")).length,
      questions: tree.questions.length,
      frontier: tree.frontier.length
    },
    persons: persons.map(serializeNode),
    questions: tree.questions.map(serializeQuestion),
    log: tree.log.slice(-12)
  };
}

function serializeNode(n) {
  return {
    id: n.id,
    name: n.name,
    relation: n.relation,
    generation: n.generation,
    birthDate: n.birthDate,
    deathDate: n.deathDate,
    birthPlace: n.birthPlace,
    deathPlace: n.deathPlace,
    sources: n.sources,
    confidence: n.confidence,
    matchScore: n.matchScore,
    wikitreeUrl: n.url,
    wikidataUrl: n.wikidataUrl || "",
    records: n.records || [],
    recordCount: n.recordCount || 0,
    parentIds: n.parentIds,
    spouseIds: n.spouseIds,
    childIds: n.childIds
  };
}

function serializeQuestion(q) {
  return {
    id: q.id,
    kind: q.kind,
    source: q.source || "wikidata",
    prompt: q.prompt,
    person: q.person,
    candidate: q.candidate,
    runnerUp: q.runnerUp,
    score: q.score,
    conflict: q.conflict,
    breakdown: q.breakdown,
    options: q.options
  };
}

function summarize(n) {
  return {
    name: n.name,
    birthDate: n.birthDate,
    deathDate: n.deathDate,
    birthPlace: n.birthPlace,
    relation: n.relation
  };
}

function flatCandidate(c) {
  return {
    name: c.name,
    birthDate: c.birthDate,
    deathDate: c.deathDate,
    birthPlace: c.birthPlace,
    deathPlace: c.deathPlace,
    url: c.url
  };
}

function yearStr(d) {
  const m = String(d || "").match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

// The town/first component of a place — Open Archives matches on place names.
function firstPlaceToken(place) {
  if (!place) return "";
  return place.split(",")[0].trim();
}

function log(tree, msg) {
  tree.log.push({ t: Date.now(), msg });
}
