// server/wikidata.js
// Wikidata client — no auth, no key. Server-side fetch only (no CORS issues).
// Wikimedia policy requires a descriptive User-Agent on every request.

const BASE = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "Kinfold/0.1 (genealogy cross-reference tool; b.spangler67@gmail.com)";

export async function searchPersons({ given, surname, birth, death }) {
  const query = [given, surname].filter(Boolean).join(" ");
  if (!query) return [];

  // Step 1: name search for candidate Qids.
  const searchParams = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    type: "item",
    format: "json",
    limit: "10"
  });
  const searchRes = await fetch(`${BASE}?${searchParams}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!searchRes.ok) throw new Error(`Wikidata search HTTP ${searchRes.status}`);
  const searchJson = await searchRes.json();

  const qids = (searchJson.search || []).map((r) => r.id);
  if (!qids.length) return [];

  // Step 2: batch fetch claims + labels.
  const entities = await fetchEntities(qids, "claims|labels");

  // Step 3: keep only humans (P31 includes Q5).
  const humans = Object.values(entities).filter(isHuman);
  if (!humans.length) return [];

  // Step 4: resolve place + gender labels in one batch call.
  const relatedQids = new Set();
  for (const e of humans) collectRelatedQids(e.claims || {}, relatedQids);
  const relatedLabels = relatedQids.size ? await fetchLabels([...relatedQids]) : {};

  // Step 5: flatten and sort by proximity to requested birth year.
  const birthYear = birth ? Number(birth) : null;
  const persons = humans.map((e) => flattenEntity(e, relatedLabels));
  if (birthYear) {
    persons.sort((a, b) => {
      const ya = yearOf(a.birthDate), yb = yearOf(b.birthDate);
      const da = ya != null ? Math.abs(ya - birthYear) : 9999;
      const db = yb != null ? Math.abs(yb - birthYear) : 9999;
      return da - db;
    });
  }
  return persons;
}

export async function getPerson(qid) {
  const entities = await fetchEntities([qid], "claims|labels");
  const entity = entities[qid];
  if (!entity || !isHuman(entity)) return null;

  const claims = entity.claims || {};
  const relatedQids = new Set();
  collectRelatedQids(claims, relatedQids);
  for (const q of getFamilyQids(claims)) relatedQids.add(q);
  const relatedLabels = relatedQids.size ? await fetchLabels([...relatedQids]) : {};

  const person = flattenEntity(entity, relatedLabels);
  person.parents = getRelationList(claims, ["P22", "P25"], relatedLabels);
  person.spouses = getRelationList(claims, ["P26"], relatedLabels);
  person.children = getRelationList(claims, ["P40"], relatedLabels);
  return person;
}

// --- API helpers ---

async function fetchEntities(qids, props = "claims|labels") {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: qids.join("|"),
    props,
    languages: "en",
    format: "json"
  });
  const res = await fetch(`${BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Wikidata entities HTTP ${res.status}`);
  const json = await res.json();
  return json.entities || {};
}

async function fetchLabels(qids) {
  const labels = {};
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels",
      languages: "en",
      format: "json"
    });
    const res = await fetch(`${BASE}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
    });
    if (!res.ok) continue;
    const json = await res.json();
    for (const [qid, entity] of Object.entries(json.entities || {})) {
      labels[qid] = entity.labels?.en?.value || qid;
    }
  }
  return labels;
}

// --- pure helpers (unit-testable without network) ---

export function parseDate(timeValue, precision) {
  // timeValue: "+1835-11-30T00:00:00Z"; precision: 9=year, 10=month, 11=day
  if (!timeValue) return "";
  const m = timeValue.match(/^[+-](\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const [, y, mo, da] = m;
  if (precision >= 11) return `${y}-${mo}-${da}`;
  if (precision >= 10) return `${y}-${mo}`;
  return y;
}

function getDateClaim(claims, prop) {
  const v = claims[prop]?.[0]?.mainsnak?.datavalue?.value;
  if (!v) return "";
  return parseDate(v.time, v.precision);
}

function getEntityQid(claims, prop) {
  return claims[prop]?.[0]?.mainsnak?.datavalue?.value?.id || null;
}

function isHuman(entity) {
  return (entity.claims?.P31 || []).some(
    (s) => s.mainsnak?.datavalue?.value?.id === "Q5"
  );
}

function collectRelatedQids(claims, set) {
  for (const prop of ["P19", "P20"]) {
    const q = getEntityQid(claims, prop);
    if (q) set.add(q);
  }
  const g = getEntityQid(claims, "P21");
  if (g) set.add(g);
}

function getFamilyQids(claims) {
  const qids = [];
  for (const prop of ["P22", "P25", "P26", "P40"]) {
    for (const s of claims[prop] || []) {
      const q = s.mainsnak?.datavalue?.value?.id;
      if (q) qids.push(q);
    }
  }
  return qids;
}

function getRelationList(claims, props, labels) {
  const result = [];
  for (const prop of props) {
    for (const s of claims[prop] || []) {
      const qid = s.mainsnak?.datavalue?.value?.id;
      if (qid) result.push({ qid, name: labels[qid] || qid });
    }
  }
  return result;
}

function resolveGender(claims, labels) {
  const qid = getEntityQid(claims, "P21");
  if (!qid) return "";
  if (qid === "Q6581097") return "Male";
  if (qid === "Q6581072") return "Female";
  return labels[qid] || "";
}

function flattenEntity(entity, labels) {
  const claims = entity.claims || {};
  const label = entity.labels?.en?.value || "";

  const toks = label.trim().split(/\s+/);
  const lastName = toks.length > 1 ? toks[toks.length - 1] : "";
  const firstName = toks.length > 1 ? toks.slice(0, -1).join(" ") : label;

  const birthPlaceQid = getEntityQid(claims, "P19");
  const deathPlaceQid = getEntityQid(claims, "P20");

  return {
    qid: entity.id,
    name: label,
    firstName,
    lastName,
    gender: resolveGender(claims, labels),
    birthDate: getDateClaim(claims, "P569"),
    deathDate: getDateClaim(claims, "P570"),
    birthPlace: birthPlaceQid ? (labels[birthPlaceQid] || "") : "",
    deathPlace: deathPlaceQid ? (labels[deathPlaceQid] || "") : "",
    url: `https://www.wikidata.org/wiki/${entity.id}`
  };
}

function yearOf(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}
