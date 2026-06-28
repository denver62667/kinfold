// server/sources/dpla.js
// Client for the Digital Public Library of America (api.dp.la) — JSON.
// Aggregates 50M+ items from US libraries, archives, and museums: letters, photos,
// yearbooks, local histories, and ephemera that reference people.
//
// Auth: one FREE API key (no paid tier). Request it (an email round-trip) per
// https://pro.dp.la/developers/policies#get-a-key and set DPLA_API_KEY. Without a
// key the source stays hidden and the rest of the app runs unchanged.
// Docs: https://pro.dp.la/developers/api-codex

const BASE = "https://api.dp.la/v2/items";
const API_KEY = process.env.DPLA_API_KEY || "";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

// Whether the source is usable (a key is configured). Lets the registry gate it.
export function hasKey() {
  return Boolean(API_KEY);
}

export async function searchRecords({ name, place = "", start = 0, count = 20 }) {
  if (!API_KEY) {
    throw new Error("DPLA needs a free API key. Set DPLA_API_KEY (request one at https://pro.dp.la/developers/policies).");
  }
  if (!name || !name.trim()) {
    throw new Error("A name is required to search DPLA.");
  }

  const pageSize = Math.min(Number(count) || 20, 50);
  const page = Math.floor((Number(start) || 0) / pageSize) + 1;

  const q = [name.trim(), place && place.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    q,
    page_size: String(pageSize),
    page: String(page),
    api_key: API_KEY
  });

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("DPLA rejected the key — check DPLA_API_KEY.");
    throw new Error(`DPLA HTTP ${res.status}`);
  }

  const json = await res.json();
  return {
    total: json.count || 0,
    results: (json.docs || []).map(flatten)
  };
}

export function flatten(doc = {}) {
  const sr = doc.sourceResource || {};
  return {
    name: clean(first(sr.title)) || "DPLA item",
    role: clean(first(sr.creator)),
    eventType: clean(first(typeof sr.type === "string" ? sr.type : first(sr.type))) || "Library / archive item",
    eventDate: yearOnly(sr.date && (sr.date.displayDate || sr.date.begin || sr.date)),
    eventPlace: clean(first(spatialName(sr.spatial))),
    sourceType: clean(doc.provider && (doc.provider.name || doc.provider)),
    archive: clean(doc.dataProvider) || "DPLA",
    snippet: truncate(clean(first(sr.description)), 220),
    url: doc.isShownAt || ""
  };
}

function spatialName(spatial) {
  const s = first(spatial);
  return s && typeof s === "object" ? (s.name || "") : s;
}

function first(v) { return Array.isArray(v) ? (v[0] || "") : (v || ""); }

function yearOnly(v) {
  const m = String(first(v) || "").match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

function truncate(s, n) { return s.length > n ? s.slice(0, n).trim() + "…" : s; }

function clean(s) {
  if (Array.isArray(s)) s = s.join(", ");
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
