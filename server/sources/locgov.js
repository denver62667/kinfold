// server/sources/locgov.js
// Client for the Library of Congress (loc.gov) JSON API — free, no auth.
// Broader than Chronicling America: photographs, manuscripts, city directories,
// printed works, and ephemera across the LoC's digital collections — many of which
// name or depict people. Documents/references, not lineage.
// Docs: https://www.loc.gov/apis/json-and-yaml/  (?fo=json on any search URL)

const BASE = "https://www.loc.gov/search/";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

export async function searchRecords({ name, place = "", start = 0, count = 20 }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search the Library of Congress.");
  }

  const perPage = Math.min(Number(count) || 20, 40);
  const page = Math.floor((Number(start) || 0) / perPage) + 1;

  const q = [name.trim(), place && place.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    q,
    fo: "json",
    c: String(perPage),
    sp: String(page)
  });

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Library of Congress HTTP ${res.status}`);

  const json = await res.json();
  const items = (json.results || []).filter((r) => r && (r.url || r.id));
  return {
    total: (json.pagination && json.pagination.of) || items.length,
    results: items.map(flatten)
  };
}

export function flatten(item = {}) {
  const url = item.url || (typeof item.id === "string" && /^https?:/.test(item.id) ? item.id : "");
  return {
    name: clean(first(item.title)) || "Library of Congress item",
    role: clean(first(item.contributor)),
    eventType: clean(first(item.original_format)) || "Library of Congress item",
    eventDate: yearOnly(item.date),
    eventPlace: clean(first(item.location)),
    sourceType: clean(first(item.partof)),
    archive: "Library of Congress",
    snippet: truncate(clean(first(item.description)), 220),
    url
  };
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
