// server/scoring.js
// Deterministic relevance scoring between a search query (the person you're looking
// for) and a document/record returned by a source. Pure functions — no I/O, easy to
// test. Returns a 0..1 score used only to rank and surface the most likely records;
// it never asserts identity. A record is evidence for the user to judge, not an
// auto-merge — so good ranking matters more than strict precision.

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

function firstToken(name) { return (name || "").trim().split(/\s+/)[0] || ""; }
function lastToken(name) { const t = (name || "").trim().split(/\s+/); return t[t.length - 1] || ""; }

// How well a record's name/text matches the queried person. A document may name the
// person inside a longer string (a newspaper headline, a book title, an event with
// several people), so we also reward the query name appearing as whole words within
// the record's name or snippet — surname weighted higher as it's more identifying.
function nameScore(query, rec) {
  const qFull = [query.firstName, query.lastName].filter(Boolean).join(" ") || query.name || "";
  const qFirst = query.firstName || firstToken(qFull);
  const qLast = query.lastName || lastToken(qFull);

  const haystacks = [rec.name, rec.snippet].filter(Boolean);
  let best = 0;
  for (const h of haystacks) {
    const direct = stringSim(qFull, h);
    const tokens = 0.4 * stringSim(qFirst, firstToken(h)) + 0.6 * stringSim(qLast, lastToken(h));
    const contains = containsName(h, qFirst, qLast);
    best = Math.max(best, direct, tokens, contains);
  }
  return best;
}

// A record's text "contains" the person when both name parts appear as whole words.
// Surname alone is partial credit (common given names are weak on their own).
function containsName(haystack, first, last) {
  const h = (haystack || "").toLowerCase();
  const hasFirst = first && new RegExp(`\\b${escapeRe(first.toLowerCase())}`).test(h);
  const hasLast = last && new RegExp(`\\b${escapeRe(last.toLowerCase())}\\b`).test(h);
  if (hasFirst && hasLast) return 0.95;
  if (hasLast) return 0.6;
  return 0;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function placeOverlap(a, b) {
  const na = (a || "").toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  const nb = (b || "").toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  if (!na.length || !nb.length) return null;
  const setB = new Set(nb);
  const shared = na.filter((t) => setB.has(t)).length;
  return shared / Math.min(na.length, nb.length);
}

// Relevance (0..1) of one record to the query. Name is the backbone; an event year
// inside the queried range nudges up (out of range nudges down); place overlap is a
// small supporting signal. The query can carry an optional { fromYear, toYear } range
// the user knows their person lived within.
export function scoreRecord(query, rec) {
  const name = nameScore(query, rec);

  const recYear = yearOf(rec.eventDate);
  let timeBonus = 0;
  const lo = query.fromYear != null && query.fromYear !== "" ? Number(query.fromYear) : null;
  const hi = query.toYear != null && query.toYear !== "" ? Number(query.toYear) : null;
  if (recYear != null && (lo != null || hi != null)) {
    const okLo = lo == null || recYear >= lo - 5;
    const okHi = hi == null || recYear <= hi + 5;
    timeBonus = okLo && okHi ? 0.1 : -0.2;
  }

  const place = placeOverlap(query.place, rec.eventPlace);
  const placeBonus = place == null ? 0 : place > 0.4 ? 0.08 : 0;

  const score = Math.max(0, Math.min(1, name + timeBonus + placeBonus));
  return Math.round(score * 100) / 100;
}
