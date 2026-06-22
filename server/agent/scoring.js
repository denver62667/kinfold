// server/agent/scoring.js
// Deterministic confidence scoring between two person records (e.g. a WikiTree
// person and a Wikidata candidate). Pure functions — no I/O, easy to test.
// Returns a 0..1 score, a tier, and a human-readable breakdown so every
// auto-merge or question the agent raises is explainable.

// --- string similarity: Dice coefficient on character bigrams (0..1) ---
function bigrams(s) {
  const t = (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const set = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    set.set(g, (set.get(g) || 0) + 1);
  }
  return set;
}

export function stringSim(a, b) {
  if (!a || !b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 1;
  const A = bigrams(a), B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) || 0);
  return (2 * overlap) / (sum(A) + sum(B));
}
function sum(map) { let s = 0; for (const n of map.values()) s += n; return s; }

export function yearOf(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

// Year proximity → 0..1. Close years strongly support a match.
function yearScore(a, b) {
  const ya = yearOf(a), yb = yearOf(b);
  if (ya == null || yb == null) return null; // unknown — excluded from scoring
  const diff = Math.abs(ya - yb);
  if (diff === 0) return 1;
  if (diff <= 2) return 0.85;
  if (diff <= 5) return 0.55;
  if (diff <= 10) return 0.25;
  return 0;
}

function normPlace(p) {
  return (p || "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}
function placeScore(a, b) {
  const na = normPlace(a), nb = normPlace(b);
  if (!na || !nb) return null;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const denom = Math.min(ta.size, tb.size) || 1;
  return shared / denom; // fraction of the smaller place's tokens that match
}

function nameScore(a, b) {
  const aFirst = a.firstName || firstToken(a.name);
  const aLast = a.lastName || lastToken(a.name);
  // Score against the candidate's label AND any aliases (pen names, maiden names,
  // anglicised forms), keeping the best — surname carries more identifying weight.
  let best = 0;
  for (const bn of candidateNames(b)) {
    const given = stringSim(aFirst, firstToken(bn));
    const surname = stringSim(aLast, lastToken(bn));
    best = Math.max(best, 0.4 * given + 0.6 * surname);
  }
  return best;
}

// All known name strings for a candidate: structured first+last, label, aliases.
function candidateNames(b) {
  const names = [];
  if (b.firstName || b.lastName) names.push(`${b.firstName || ""} ${b.lastName || ""}`.trim());
  if (b.name) names.push(b.name);
  for (const al of b.aliases || []) names.push(al);
  return names.length ? names : [""];
}
function firstToken(name) { return (name || "").trim().split(/\s+/)[0] || ""; }
function lastToken(name) { const t = (name || "").trim().split(/\s+/); return t[t.length - 1] || ""; }

const TIERS = { high: 0.84, medium: 0.62 };

// Compare two person-shaped objects. Each should have name/firstName/lastName,
// birthDate, deathDate, birthPlace, deathPlace where available.
export function scoreMatch(a, b, tiers = TIERS) {
  const parts = [
    { key: "name", weight: 0.45, value: nameScore(a, b) },
    { key: "birthYear", weight: 0.25, value: yearScore(a.birthDate, b.birthDate) },
    { key: "deathYear", weight: 0.15, value: yearScore(a.deathDate, b.deathDate) },
    { key: "birthPlace", weight: 0.1, value: placeScore(a.birthPlace, b.birthPlace) },
    { key: "deathPlace", weight: 0.05, value: placeScore(a.deathPlace, b.deathPlace) }
  ];

  // Renormalize weights over the fields we could actually compare.
  const present = parts.filter((p) => p.value != null);
  const totalW = present.reduce((s, p) => s + p.weight, 0) || 1;
  const score = present.reduce((s, p) => s + p.weight * p.value, 0) / totalW;

  const tier = score >= tiers.high ? "high" : score >= tiers.medium ? "medium" : "low";

  // Name-only evidence is never enough to auto-merge: with no corroborating
  // date or place, downgrade a "high" to "medium" so the agent asks instead.
  const corroborating = present.filter((p) => p.key !== "name").length;
  const finalTier = tier === "high" && corroborating === 0 ? "medium" : tier;

  // Flag a hard conflict: names look like a match but a known birth year is far off.
  const by = parts.find((p) => p.key === "birthYear");
  const conflict = by && by.value != null && by.value < 0.25 && nameScore(a, b) > 0.7;

  return {
    score: Math.round(score * 100) / 100,
    tier: finalTier,
    corroborating,
    conflict: Boolean(conflict),
    breakdown: parts.map((p) => ({ field: p.key, score: p.value == null ? null : Math.round(p.value * 100) / 100 }))
  };
}

export { TIERS };

// Lightweight relevance score (0..1) for an event-based record (e.g. Open
// Archives) against a person. Records have a name, an event year and place, but
// no structured birth/death — so this leans on the name, with a lifespan sanity
// check and place overlap as supporting signals. Used for corroboration only,
// never to merge identities.
export function scoreRecord(person, rec) {
  const pFull = person.name || `${person.firstName || ""} ${person.lastName || ""}`;
  const nameSim = Math.max(
    stringSim(pFull, rec.name || ""),
    0.4 * stringSim(person.firstName || firstToken(pFull), firstToken(rec.name || "")) +
      0.6 * stringSim(person.lastName || lastToken(pFull), lastToken(rec.name || ""))
  );

  const recYear = yearOf(rec.eventDate);
  const by = yearOf(person.birthDate);
  const dy = yearOf(person.deathDate);
  let timeBonus = 0;
  if (recYear != null && (by != null || dy != null)) {
    const lo = (by != null ? by : dy - 90) - 5;
    const hi = (dy != null ? dy : by + 90) + 5;
    timeBonus = recYear >= lo && recYear <= hi ? 0.1 : -0.15; // in-lifespan helps, far-off hurts
  }

  const place = placeOverlap(person.birthPlace, rec.eventPlace);
  const placeBonus = place == null ? 0 : place > 0.4 ? 0.08 : 0;

  return Math.max(0, Math.min(1, nameSim + timeBonus + placeBonus));
}

function placeOverlap(a, b) {
  const na = (a || "").toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  const nb = (b || "").toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  if (!na.length || !nb.length) return null;
  const setB = new Set(nb);
  const shared = na.filter((t) => setB.has(t)).length;
  return shared / Math.min(na.length, nb.length);
}
