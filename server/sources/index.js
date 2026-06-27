// server/sources/index.js
// Source registry. Every source exposes the same searchRecords({ name, place,
// fromYear, toYear, start, count }) → { total, results } contract and returns the
// shared flattened record shape, so routes and the UI stay source-agnostic.
//
//   { name, role, eventType, eventDate, eventPlace, sourceType, archive, snippet, url }
//
// To add a source: drop a module in this dir and register it below. `accent` is the
// one CSS accent color it gets in the UI (see public/styles.css). `available` is an
// optional predicate — a key-gated source returns false until its key is set, and is
// then hidden from /api/sources and skipped by /api/search so the app still runs.

import * as openarchives from "./openarchives.js";
import * as chroniclingamerica from "./chroniclingamerica.js";
import * as internetarchive from "./internetarchive.js";
import * as locgov from "./locgov.js";
import * as nationalarchivesuk from "./nationalarchivesuk.js";
import * as dpla from "./dpla.js";
import * as trove from "./trove.js";

export const SOURCES = [
  {
    id: "openarchives",
    label: "Open Archives",
    accent: "records",
    region: "NL · BE · FR",
    description: "Vital records — births, baptisms, marriages, deaths. Primary documents about people.",
    search: openarchives.searchRecords
  },
  {
    id: "chroniclingamerica",
    label: "Chronicling America",
    accent: "news",
    region: "US · 1756–1963",
    description: "Full-text historic US newspapers (Library of Congress). Mentions, notices, obituaries.",
    search: chroniclingamerica.searchRecords
  },
  {
    id: "internetarchive",
    label: "Internet Archive",
    accent: "texts",
    region: "Worldwide",
    description: "Digitized genealogies, family & local histories, biographical encyclopedias, directories.",
    search: internetarchive.searchRecords
  },
  {
    id: "locgov",
    label: "Library of Congress",
    accent: "loc",
    region: "US · broad",
    description: "Photographs, manuscripts, city directories and printed works across the LoC collections.",
    search: locgov.searchRecords
  },
  {
    id: "nationalarchivesuk",
    label: "National Archives UK",
    accent: "tna",
    region: "UK · Commonwealth",
    description: "~35M archival descriptions — wills, military service, court, prison and immigration records.",
    search: nationalarchivesuk.searchRecords
  },
  {
    id: "dpla",
    label: "DPLA",
    accent: "dpla",
    region: "US · aggregated",
    description: "50M+ items from US libraries, archives and museums — letters, photos, yearbooks, local history.",
    search: dpla.searchRecords,
    available: dpla.hasKey
  },
  {
    id: "trove",
    label: "Trove",
    accent: "trove",
    region: "AU · NZ",
    description: "National Library of Australia — digitised newspapers and gazettes that mention people.",
    search: trove.searchRecords,
    available: trove.hasKey
  }
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function getSource(id) {
  return BY_ID.get(id);
}

// A source is usable unless it declares an `available` predicate that returns false
// (e.g. a key-gated source with no key configured).
export function isAvailable(src) {
  return typeof src.available === "function" ? Boolean(src.available()) : true;
}

// Only the sources usable right now — what the UI should fan out across by default.
export function availableSources() {
  return SOURCES.filter(isAvailable);
}

// Public metadata for the UI (no function refs). Hides gated sources without a key.
export function listSources() {
  return availableSources().map(({ id, label, accent, region, description }) => ({
    id, label, accent, region, description
  }));
}
