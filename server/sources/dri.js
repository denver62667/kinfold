// server/sources/dri.js
// Client for the Digital Repository of Ireland (repository.dri.ie) — free, no auth.
// A national repository of Irish humanities/social-science archival collections:
// letters, photographs, parish and institutional records, oral histories — documents
// that reference people. References, not a lineage tree.
// Built on Blacklight, whose catalog endpoint returns JSON via ?format=json.
// Docs: https://repository.dri.ie/  (Blacklight search API)

const BASE = "https://repository.dri.ie/catalog";
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

export async function searchRecords({ name, place = "", start = 0, count = 20 }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search the Digital Repository of Ireland.");
  }

  const perPage = Math.min(Number(count) || 20, 50);
  const page = Math.floor((Number(start) || 0) / perPage) + 1;

  const q = [name.trim(), place && place.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    q,
    format: "json",
    per_page: String(perPage),
    page: String(page)
  });

  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Digital Repository of Ireland HTTP ${res.status}`);

  const json = await res.json();
  const { docs, total } = normalize(json);
  return { total, results: docs.map(flatten) };
}

// Blacklight's JSON shape varies by version. Older returns
// { response: { docs:[...], pages:{ total_count } } }; newer (JSON:API) returns
// { data:[ { id, attributes:{...} } ], meta:{ pages:{ total_count } } }. Flatten both
// into plain docs that carry `id` plus the Solr-style metadata fields.
export function normalize(json = {}) {
  if (Array.isArray(json.data)) {
    const total = json.meta?.pages?.total_count ?? json.data.length;
    const docs = json.data.map((d) => ({ id: d.id, ...(d.attributes || {}) }));
    return { docs, total };
  }
  const resp = json.response || {};
  return { docs: resp.docs || [], total: resp.pages?.total_count ?? (resp.docs || []).length };
}

export function flatten(doc = {}) {
  const id = doc.id || "";
  return {
    name: pick(doc, ["title_tesim", "title_tsim", "title"]) || "Repository object",
    role: pick(doc, ["creator_tesim", "author_tesim", "creator"]),
    eventType: pick(doc, ["type_tesim", "file_type_tesim"]) || "Repository object",
    eventDate: yearOnly(pick(doc, ["creation_date_str_si", "published_date_str_si", "date_tesim", "creation_date"])),
    eventPlace: pick(doc, ["geographical_coverage_tesim", "coverage_tesim"]),
    sourceType: pick(doc, ["root_collection_title_tesim", "collection_title_tesim", "isGovernedBy_ssim"]),
    archive: "Digital Repository of Ireland",
    snippet: truncate(pick(doc, ["description_tesim", "description"]), 220),
    url: id ? `https://repository.dri.ie/catalog/${encodeURIComponent(id)}` : ""
  };
}

// First non-empty value among candidate Solr field names (each may be array or string).
function pick(doc, keys) {
  for (const k of keys) {
    const v = doc[k];
    const s = clean(Array.isArray(v) ? v[0] : v);
    if (s) return s;
  }
  return "";
}

function yearOnly(v) {
  const m = String(v || "").match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

function truncate(s, n) { return s.length > n ? s.slice(0, n).trim() + "…" : s; }

function clean(s) {
  if (Array.isArray(s)) s = s.join(", ");
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
