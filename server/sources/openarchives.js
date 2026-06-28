// server/sources/openarchives.js
// Client for the Open Archives API (openarch.nl) — free, no auth, JSON.
// Aggregates ~277M genealogical records (births, baptisms, marriages, deaths) from
// Dutch, Belgian and French archives — primary documents about people.
// Docs: https://www.openarch.nl/api/docs/  | rate limit: 4 req/s per IP.

const BASE = "https://api.openarch.nl/1.1";
// Open Archives asks for a descriptive User-Agent so they can reach the operator.
const USER_AGENT = "Kinfold/0.2 (document-first genealogy search; b.spangler67@gmail.com)";

// Unified source signature: ({ name, place, fromYear, toYear, start, count }).
export async function searchRecords({ name, place = "", start = 0, count = 20, lang = "en" }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search Open Archives.");
  }

  const params = new URLSearchParams({
    name: name.trim(),
    number_show: String(Math.min(Number(count) || 20, 100)),
    start: String(Number(start) || 0),
    sort: "4", // by date
    lang
  });
  const firstPlace = firstPlaceToken(place);
  if (firstPlace) params.set("eventplace", firstPlace);

  const res = await fetch(`${BASE}/records/search.json?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Open Archives HTTP ${res.status}`);

  const json = await res.json();
  if (json.error_code) {
    throw new Error(json.error_description || `Open Archives error ${json.error_code}`);
  }

  const response = json.response || {};
  return {
    total: response.number_found || 0,
    results: (response.docs || []).map(flatten)
  };
}

export function flatten(doc = {}) {
  const d = doc.eventdate || {};
  const date = [d.year, pad(d.month), pad(d.day)].filter(Boolean).join("-");
  // The record's own page; build it from archive_code + identifier if absent.
  const url =
    doc.url ||
    (doc.archive_code && doc.identifier
      ? `https://www.openarchieven.nl/${doc.archive_code}:${doc.identifier}/en`
      : "");

  return {
    name: (doc.personname || "").trim(),
    role: doc.relationtype || "",
    eventType: doc.eventtype || "",
    eventDate: date,
    eventPlace: doc.eventplace || "",
    sourceType: doc.sourcetype || "",
    archive: doc.archive || doc.archive_org || "",
    snippet: "",
    url
  };
}

// Open Archives matches on place names — pass the town/first component only.
function firstPlaceToken(place) {
  if (!place) return "";
  return place.split(",")[0].trim();
}

function pad(n) {
  return n ? String(n).padStart(2, "0") : "";
}
