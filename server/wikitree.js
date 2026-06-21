// server/wikitree.js
// Server-side client for the WikiTree API. Called from our backend so we never
// hit the browser CORS restriction (api.wikitree.com does not allow cross-origin:*).
// API is read-only and returns JSON arrays. Docs: https://github.com/wikitree/wikitree-api

const BASE = "https://api.wikitree.com/api.php";
const APP_ID = process.env.WIKITREE_APP_ID || "kinfold";

// Fields we care about for a person dossier.
const PROFILE_FIELDS = [
  "Id", "PageId", "Name", "FirstName", "MiddleName", "LastNameAtBirth",
  "LastNameCurrent", "BirthDate", "DeathDate", "BirthLocation", "DeathLocation",
  "Gender", "Father", "Mother", "Derived.LongName", "Bio", "Photo"
].join(",");

async function call(params) {
  const body = new URLSearchParams({ ...params, appId: APP_ID, format: "json" });
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    throw new Error(`WikiTree API HTTP ${res.status}`);
  }
  return res.json();
}

// Search for people by name and (optionally) birth/death year.
// Returns an array of lightweight match objects.
export async function searchPerson({ firstName = "", lastName = "", birthDate = "", deathDate = "", limit = 10 }) {
  const data = await call({
    action: "searchPerson",
    FirstName: firstName,
    LastName: lastName,
    BirthDate: birthDate,
    DeathDate: deathDate,
    fields: "Id,Name,FirstName,LastNameAtBirth,BirthDate,DeathDate,BirthLocation,Derived.LongName",
    limit: String(limit)
  });

  // searchPerson returns [{ status, matches: [...] }]
  const block = Array.isArray(data) ? data[0] : data;
  const matches = block?.matches || [];
  return matches.map(normalizeProfile);
}

// Full profile for one person, keyed by WikiTree ID (e.g. "Clemens-1").
export async function getProfile(key, { bioFormat = "html" } = {}) {
  const data = await call({
    action: "getProfile",
    key,
    fields: PROFILE_FIELDS,
    bioFormat
  });
  const block = Array.isArray(data) ? data[0] : data;
  if (!block || block.status) {
    throw new Error(typeof block?.status === "string" ? block.status : "Profile not found");
  }
  return normalizeProfile(block.profile);
}

// Parents, children, siblings, spouses for one person.
export async function getRelatives(key) {
  const data = await call({
    action: "getRelatives",
    keys: key,
    fields: "Id,Name,FirstName,LastNameAtBirth,BirthDate,DeathDate,BirthLocation,DeathLocation,Gender,Derived.LongName",
    getParents: "1",
    getChildren: "1",
    getSiblings: "1",
    getSpouses: "1"
  });

  const block = Array.isArray(data) ? data[0] : data;
  const item = block?.items?.[0]?.person || {};
  const pull = (rel) => Object.values(item[rel] || {}).map(normalizeProfile);

  return {
    parents: pull("Parents"),
    spouses: pull("Spouses"),
    children: pull("Children"),
    siblings: pull("Siblings")
  };
}

// Direct-line ancestors to a given depth (pedigree).
export async function getAncestors(key, depth = 4) {
  const data = await call({ action: "getAncestors", key, depth: String(depth),
    fields: "Id,Name,FirstName,LastNameAtBirth,BirthDate,DeathDate,Derived.LongName" });
  const block = Array.isArray(data) ? data[0] : data;
  return (block?.ancestors || []).map(normalizeProfile);
}

function normalizeProfile(p = {}) {
  return {
    id: p.Id,
    wikitreeId: p.Name,                       // e.g. "Clemens-1"
    name: p.LongName || p["Derived.LongName"] ||
          [p.FirstName, p.MiddleName, p.LastNameAtBirth].filter(Boolean).join(" "),
    firstName: p.FirstName || "",
    lastName: p.LastNameAtBirth || p.LastNameCurrent || "",
    gender: p.Gender || "",
    birthDate: cleanDate(p.BirthDate),
    deathDate: cleanDate(p.DeathDate),
    birthPlace: p.BirthLocation || "",
    deathPlace: p.DeathLocation || "",
    fatherId: p.Father || null,
    motherId: p.Mother || null,
    bio: p.bio || p.Bio || "",
    photo: p.Photo || "",
    url: p.Name ? `https://www.wikitree.com/wiki/${p.Name}` : ""
  };
}

// WikiTree uses "0000-00-00" / partial dates for unknowns.
function cleanDate(d) {
  if (!d || d === "0000-00-00") return "";
  return d.replace(/-00/g, ""); // 1835-00-00 -> 1835, 1835-11-00 -> 1835-11
}
