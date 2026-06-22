// server/europeana.js
// Client for the Europeana Search API (api.europeana.eu) — a free aggregator of
// ~50M+ cultural-heritage and archival items from institutions across Europe,
// including the UK (England, Scotland, Wales) and Germany. Corroboration only:
// it surfaces archival documents, registers, and heritage records that mention a
// person or place — it never merges identity or expands relationships.
//
// Auth: one FREE API key (no paid tier). Get one at https://pro.europeana.eu/get-api
// and set EUROPEANA_API_KEY. Without a key the source stays disabled and the rest
// of the app runs unchanged.
// Docs: https://europeana.atlassian.net/wiki/spaces/EF/pages/2385739812/Search+API+Documentation

const BASE = "https://api.europeana.eu/record/v2/search.json";
const API_KEY = process.env.EUROPEANA_API_KEY || "";
// Wikimedia-style courtesy: identify the app with a reachable contact.
const USER_AGENT = "Kinfold/0.1 (genealogy cross-reference tool; b.spangler67@gmail.com)";

// Whether the source is usable (a key is configured). Lets routes/agent gate it.
export function hasKey() {
  return Boolean(API_KEY);
}

export async function searchRecords({ name, place = "", country = "", start = 0, count = 20 }) {
  if (!API_KEY) {
    throw new Error(
      "Europeana needs a free API key. Set EUROPEANA_API_KEY (get one at https://pro.europeana.eu/get-api)."
    );
  }
  if (!name || !name.trim()) {
    throw new Error("A name is required to search Europeana.");
  }

  const params = new URLSearchParams({
    wskey: API_KEY,
    query: buildQuery(name, place),
    rows: String(Math.min(Number(count) || 20, 100)),
    start: String((Number(start) || 0) + 1), // Europeana paging is 1-based
    profile: "standard"
  });
  // Optional country filter. NOTE: Europeana's COUNTRY facet is the *providing
  // institution's* country, not the person's — so it narrows to records held by
  // that country's archives. Useful but lossy; left to the user, default "Any".
  // (We deliberately don't filter by TYPE: genealogical records are often
  // scanned IMAGES, not TEXT, so a TEXT filter would hide the best material.)
  if (country.trim()) params.append("qf", `COUNTRY:${country.trim()}`);

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });

  // Europeana returns a JSON body with an `error` message even on failures —
  // surface it (e.g. "Invalid API key") instead of a bare status code.
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.success === false)) {
    const msg = json && json.error ? json.error : `Europeana HTTP ${res.status}`;
    throw new Error(/api key/i.test(msg) ? `${msg} — check EUROPEANA_API_KEY.` : msg);
  }
  if (!json) throw new Error("Europeana returned an unreadable response.");

  return {
    total: json.totalResults || 0,
    results: (json.items || []).map(flatten)
  };
}

// Quote the name so multi-word names match as a phrase, AND-ing an optional
// place/country term to narrow the (often broad) heritage corpus.
function buildQuery(name, place) {
  const phrase = `"${name.trim().replace(/"/g, "")}"`;
  const extra = place && place.trim() ? ` AND ${place.trim()}` : "";
  return phrase + extra;
}

// Map a Europeana item onto the same flattened record shape the rest of the app
// uses (mirrors openarchives.js so the agent + UI stay source-agnostic).
function flatten(item = {}) {
  const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");
  const provider = clean(first(item.dataProvider)) || clean(first(item.provider));
  return {
    name: clean(first(item.title)) || clean(first(item.dcCreator)) || "Untitled record",
    role: "",
    eventType: "Archival / heritage record",
    eventDate: yearOnly(first(item.year)),
    eventPlace: clean(first(item.country)),
    sourceType: provider,
    archive: provider || "Europeana",
    url: item.guid || (item.id ? `https://www.europeana.eu/item${item.id}` : "")
  };
}

function yearOnly(v) {
  const m = String(v || "").match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
