// server/sources/internetarchive.js
// Client for the Internet Archive (archive.org) — free, no auth, JSON.
// Searches digitized texts: published genealogies, family histories, county/town
// histories, biographical encyclopedias, city directories. These are exactly the
// secondary documents that *reference* a person and their ancestors — often the
// "new information" beyond vital-record indexes.
// Docs: https://archive.org/advancedsearch.php (output=json)

const BASE = "https://archive.org/advancedsearch.php";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

const FIELDS = ["identifier", "title", "creator", "date", "year", "description", "mediatype", "publicdate"];

// Unified source signature. Restricts to text media so results are readable
// documents (books/periodicals), not audio/video/software.
export async function searchRecords({ name, place = "", fromYear, toYear, start = 0, count = 20 }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search the Internet Archive.");
  }

  const rows = Math.min(Number(count) || 20, 50);
  const page = Math.floor((Number(start) || 0) / rows) + 1;

  const params = new URLSearchParams({
    q: buildQuery(name, place, fromYear, toYear),
    output: "json",
    rows: String(rows),
    page: String(page)
  });
  for (const f of FIELDS) params.append("fl[]", f);
  params.append("sort[]", "year asc");

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Internet Archive HTTP ${res.status}`);

  const json = await res.json();
  const resp = json.response || {};
  return {
    total: resp.numFound || 0,
    results: (resp.docs || []).map(flatten)
  };
}

// Phrase-match the name, AND an optional place, AND a year range, scoped to texts.
export function buildQuery(name, place, fromYear, toYear) {
  const parts = [`"${name.trim().replace(/"/g, "")}"`, "mediatype:texts"];
  if (place && place.trim()) parts.push(`"${place.trim().replace(/"/g, "")}"`);
  const lo = yearNum(fromYear);
  const hi = yearNum(toYear);
  if (lo || hi) parts.push(`year:[${lo || 1400} TO ${hi || 2000}]`);
  return parts.join(" AND ");
}

export function flatten(doc = {}) {
  const id = doc.identifier || "";
  return {
    name: clean(doc.title) || "Untitled text",
    role: clean(first(doc.creator)),
    eventType: "Published text",
    eventDate: yearOnly(doc.year || doc.date),
    eventPlace: "",
    sourceType: clean(doc.mediatype) || "text",
    archive: "Internet Archive",
    snippet: truncate(clean(first(doc.description)), 220),
    url: id ? `https://archive.org/details/${id}` : ""
  };
}

function first(v) { return Array.isArray(v) ? (v[0] || "") : (v || ""); }

function yearOnly(v) {
  const m = String(first(v) || "").match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

function yearNum(v) {
  const m = String(v ?? "").match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}

function clean(s) {
  if (Array.isArray(s)) s = s.join(", ");
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
