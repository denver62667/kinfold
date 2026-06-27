// server/sources/chroniclingamerica.js
// Client for Chronicling America (Library of Congress) — free, no auth, JSON.
// Full-text search across ~20M digitized historic US newspaper pages (1756–1963).
// A name search surfaces articles, notices, and mentions of a person — the kind of
// "new information" a tree database won't have. Documents/references, not lineage.
// Docs: https://chroniclingamerica.loc.gov/about/api/

const BASE = "https://chroniclingamerica.loc.gov/search/pages/results/";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

// Unified source signature. Paging is by page number (rows per page); we translate
// the app's start/count offsets into the nearest page request.
export async function searchRecords({ name, place = "", fromYear, toYear, start = 0, count = 20 }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search Chronicling America.");
  }

  const rows = Math.min(Number(count) || 20, 50);
  const page = Math.floor((Number(start) || 0) / rows) + 1;

  const params = new URLSearchParams({
    andtext: name.trim(),
    format: "json",
    rows: String(rows),
    page: String(page)
  });
  // Optional decade/year bounds. Chronicling America filters by full year via
  // dateFilterType=yearRange + date1/date2 (4-digit years).
  const lo = yearNum(fromYear);
  const hi = yearNum(toYear);
  if (lo || hi) {
    params.set("dateFilterType", "yearRange");
    params.set("date1", String(lo || 1756));
    params.set("date2", String(hi || 1963));
  }
  if (place && place.trim()) params.set("state", place.trim());

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Chronicling America HTTP ${res.status}`);

  const json = await res.json();
  return {
    total: json.totalItems || 0,
    results: (json.items || []).map((it) => flatten(it, name))
  };
}

// `query` lets us cut the OCR snippet around the searched name when possible.
export function flatten(item = {}, query = "") {
  const title = clean(item.title) || "Newspaper page";
  const place = [item.city, item.state].flat().filter(Boolean).join(", ") ||
    clean(item.place_of_publication);
  const url = item.id
    ? `https://chroniclingamerica.loc.gov${item.id}`
    : (item.url || "").replace(/\.json$/, "");

  return {
    name: title,
    role: "",
    eventType: "Newspaper article",
    eventDate: clean(item.date_filed) || formatDate(item.date),
    eventPlace: place,
    sourceType: clean(item.title_normal) || "Historic newspaper",
    archive: "Chronicling America · Library of Congress",
    snippet: snippetAround(item.ocr_eng, query),
    url
  };
}

// Pull a readable window of OCR text around the first occurrence of the query name.
function snippetAround(ocr, query) {
  const text = clean(ocr);
  if (!text) return "";
  const q = (query || "").trim().split(/\s+/).filter(Boolean).pop(); // surname-ish
  if (q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, i - 80);
      const end = Math.min(text.length, i + 120);
      return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
    }
  }
  return text.slice(0, 200).trim() + (text.length > 200 ? "…" : "");
}

// Chronicling America `date` is "YYYYMMDD".
function formatDate(d) {
  const m = String(d || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (String(d || "").match(/\b\d{4}\b/)?.[0] || "");
}

function yearNum(v) {
  const m = String(v ?? "").match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

function clean(s) {
  if (Array.isArray(s)) s = s.join(", ");
  return String(s || "").replace(/\s+/g, " ").trim();
}
