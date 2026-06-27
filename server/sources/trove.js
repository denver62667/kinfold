// server/sources/trove.js
// Client for Trove (National Library of Australia) — v3 API, JSON.
// Digitised newspapers and gazettes (plus government gazettes and records) that
// mention people — strong for Australian and New Zealand ancestors.
//
// Auth: one FREE API key. Request it at https://trove.nla.gov.au/about/create-something/
// using-api and set TROVE_API_KEY. Without a key the source stays hidden and the rest
// of the app runs unchanged.
// Docs: https://trove.nla.gov.au/about/create-something/using-api/v3-introduction

const BASE = "https://api.trove.nla.gov.au/v3/result";
const API_KEY = process.env.TROVE_API_KEY || "";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

export function hasKey() {
  return Boolean(API_KEY);
}

// Trove v3 deep-pages with an opaque cursor (`s`), not numeric offsets, so we serve
// the first page of newspaper/gazette matches (count up to the page size).
export async function searchRecords({ name, place = "", count = 20 }) {
  if (!API_KEY) {
    throw new Error("Trove needs a free API key. Set TROVE_API_KEY (request one at https://trove.nla.gov.au/about/create-something/using-api).");
  }
  if (!name || !name.trim()) {
    throw new Error("A name is required to search Trove.");
  }

  const n = Math.min(Number(count) || 20, 50);
  const q = [name.trim(), place && place.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    q,
    category: "newspaper",
    encoding: "json",
    n: String(n)
  });

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "X-API-KEY": API_KEY }
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("Trove rejected the key — check TROVE_API_KEY.");
    throw new Error(`Trove HTTP ${res.status}`);
  }

  const json = await res.json();
  const category = (json.category || [])[0] || {};
  const records = category.records || {};
  const articles = records.article || [];
  return {
    total: Number(records.total) || articles.length,
    results: articles.map(flatten)
  };
}

export function flatten(a = {}) {
  const paper = a.title && (a.title.value || a.title.title) ? (a.title.value || a.title.title) : "";
  return {
    name: clean(a.heading) || "Newspaper article",
    role: "",
    eventType: clean(a.category) || "Newspaper article",
    eventDate: clean(a.date),
    eventPlace: clean(paper),
    sourceType: clean(paper),
    archive: "Trove · National Library of Australia",
    snippet: truncate(clean(a.snippet), 220),
    url: a.troveUrl || (a.identifier ? a.identifier : "")
  };
}

function truncate(s, n) { return s.length > n ? s.slice(0, n).trim() + "…" : s; }

function clean(s) {
  if (Array.isArray(s)) s = s.join(", ");
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
