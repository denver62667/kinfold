// server/sources/nationalarchivesuk.js
// Client for The National Archives (UK) Discovery API — free, no auth, JSON.
// ~35M descriptions of archival records that reference people: wills, military
// service, court and prison records, immigration, and more — held by TNA and
// thousands of other UK archives. References to people, not a lineage tree.
// Docs: https://discovery.nationalarchives.gov.uk/API/sandbox/index

const BASE = "https://discovery.nationalarchives.gov.uk/API/search/records";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

export async function searchRecords({ name, place = "", fromYear, toYear, start = 0, count = 20 }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search The National Archives.");
  }

  const perPage = Math.min(Number(count) || 20, 50);
  const page = Math.floor((Number(start) || 0) / perPage) + 1;

  const q = [name.trim(), place && place.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    "sps.searchQuery": q,
    "sps.resultsPageSize": String(perPage),
    "sps.page": String(page),
    "sps.sortByOption": "RELEVANCE"
  });
  const lo = yearNum(fromYear);
  const hi = yearNum(toYear);
  if (lo) params.set("sps.dateFrom", `${lo}-01-01`);
  if (hi) params.set("sps.dateTo", `${hi}-12-31`);

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`National Archives HTTP ${res.status}`);

  const json = await res.json();
  return {
    total: json.count || (json.records || []).length,
    results: (json.records || []).map(flatten)
  };
}

export function flatten(rec = {}) {
  const description = clean(rec.description);
  const name = clean(rec.title) || clean(rec.reference) || truncate(description, 80) || "Archival record";
  const url = rec.id ? `https://discovery.nationalarchives.gov.uk/details/r/${encodeURIComponent(rec.id)}` : "";
  return {
    name,
    role: "",
    eventType: "Archival record",
    eventDate: yearOnly(rec.coveringDates),
    eventPlace: clean(first(rec.places)),
    sourceType: clean(rec.reference) || clean(rec.catalogueLevel),
    archive: clean(rec.heldBy && first(rec.heldBy)) || "The National Archives (UK)",
    snippet: truncate(description, 220),
    url
  };
}

function first(v) { return Array.isArray(v) ? (v[0] || "") : (v || ""); }

function yearOnly(v) {
  const m = String(v || "").match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

function yearNum(v) {
  const m = String(v ?? "").match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n).trim() + "…" : s; }

function clean(s) {
  if (Array.isArray(s)) s = s.map((x) => (x && x.xReferenceName) || x).join(", ");
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
