// server/openarchives.js
// Client for the Open Archives API (openarch.nl) — free, no auth, JSON.
// Aggregates ~277M genealogical records from Dutch, Belgian and French archives.
// Docs: https://www.openarch.nl/api/docs/  | rate limit: 4 req/s per IP.

const BASE = "https://api.openarch.nl/1.1";
// Open Archives asks for a descriptive User-Agent so they can reach the operator.
const USER_AGENT = "Kinfold/0.1 (genealogy cross-reference tool)";

export async function searchRecords({ name, eventplace = "", start = 0, count = 20, lang = "en" }) {
  if (!name || !name.trim()) {
    throw new Error("A name is required to search Open Archives.");
  }

  const params = new URLSearchParams({
    name: name.trim(),
    number_show: String(Math.min(count, 100)),
    start: String(start),
    sort: "4", // by date
    lang
  });
  if (eventplace.trim()) params.set("eventplace", eventplace.trim());

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

function flatten(doc = {}) {
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
    url
  };
}

function pad(n) {
  return n ? String(n).padStart(2, "0") : "";
}
