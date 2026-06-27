// server/sources/index.js
// Source registry. Every source exposes the same searchRecords({ name, place,
// fromYear, toYear, start, count }) → { total, results } contract and returns the
// shared flattened record shape, so routes and the UI stay source-agnostic.
//
//   { name, role, eventType, eventDate, eventPlace, sourceType, archive, snippet, url }
//
// To add a source: drop a module in this dir and register it below. `accent` is the
// one CSS accent color it gets in the UI (see public/styles.css).

import * as openarchives from "./openarchives.js";
import * as chroniclingamerica from "./chroniclingamerica.js";
import * as internetarchive from "./internetarchive.js";

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
  }
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function getSource(id) {
  return BY_ID.get(id);
}

// Public metadata for the UI (no function refs).
export function listSources() {
  return SOURCES.map(({ id, label, accent, region, description }) => ({
    id, label, accent, region, description
  }));
}
