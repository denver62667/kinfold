// server/agent/gedcom.js
// Export an agent tree as GEDCOM 5.5.1 — the lineage-linked format that nearly
// every genealogy program (Ancestry, Gramps, RootsMagic, etc.)
// can import. Operates on the internal tree (persons Map), which carries the
// name parts, gender, and relationship links the snapshot trims out.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function treeToGedcom(tree, { submitter = "Kinfold" } = {}) {
  const nodes = [...tree.persons.values()];

  // Stable xrefs for individuals.
  const indiXref = new Map();
  nodes.forEach((n, i) => indiXref.set(n.id, `@I${i + 1}@`));

  // --- group people into families (couple + their children) ---
  // Key a family by the sorted ids of its parent couple. A child's parents
  // define one; a childless couple (spouse link) defines one too.
  const families = new Map(); // key -> { parents:Set, children:Set }
  const keyOf = (ids) => [...ids].sort().join("+");
  const famFor = (parentIds) => {
    const ids = parentIds.slice(0, 2);
    const key = keyOf(ids);
    if (!families.has(key)) families.set(key, { parents: new Set(ids), children: new Set() });
    return families.get(key);
  };

  for (const n of nodes) {
    if (n.parentIds && n.parentIds.length) famFor(n.parentIds).children.add(n.id);
  }
  for (const n of nodes) {
    for (const sp of n.spouseIds || []) famFor([n.id, sp]); // ensure childless couples exist
  }

  const famList = [...families.entries()];
  const famXref = new Map();
  famList.forEach(([key], i) => famXref.set(key, `@F${i + 1}@`));

  // Individual → families they're a spouse/parent in, and the one they're a child in.
  const fams = new Map(); // personId -> [famXref]
  const famc = new Map(); // personId -> famXref
  const addFams = (pid, fx) => { if (!fams.has(pid)) fams.set(pid, []); fams.get(pid).push(fx); };
  for (const [key, fam] of famList) {
    const fx = famXref.get(key);
    for (const pid of fam.parents) addFams(pid, fx);
    for (const cid of fam.children) famc.set(cid, fx);
  }

  // --- emit ---
  const lines = [];
  const out = (level, tag, value) =>
    lines.push(value ? `${level} ${tag} ${clean(value)}` : `${level} ${tag}`);

  // Header
  out(0, "HEAD");
  out(1, "SOUR", "Kinfold");
  out(2, "NAME", "Kinfold");
  out(2, "VERS", "0.1");
  out(1, "GEDC");
  out(2, "VERS", "5.5.1");
  out(2, "FORM", "LINEAGE-LINKED");
  out(1, "CHAR", "UTF-8");
  out(1, "DATE", gedcomDate(new Date().toISOString().slice(0, 10)));
  out(1, "SUBM", "@SUB1@");
  out(0, "@SUB1@ SUBM");
  out(1, "NAME", submitter);

  // Individuals
  for (const n of nodes) {
    out(0, `${indiXref.get(n.id)} INDI`);
    const { given, surname } = nameParts(n);
    out(1, "NAME", `${given} /${surname}/`.trim());
    if (given) out(2, "GIVN", given);
    if (surname) out(2, "SURN", surname);
    const sex = sexOf(n.gender);
    if (sex) out(1, "SEX", sex);

    emitEvent(out, "BIRT", n.birthDate, n.birthPlace);
    emitEvent(out, "DEAT", n.deathDate, n.deathPlace);

    if (famc.has(n.id)) out(1, "FAMC", famc.get(n.id));
    for (const fx of fams.get(n.id) || []) out(1, "FAMS", fx);

    // Provenance as notes (portable across importers).
    const srcLabel = (n.sources || [])
      .map((s) =>
        s === "wikitree" ? "WikiTree"
        : s === "wikidata" ? "Wikidata"
        : s === "openarchives" ? "Open Archives"
        : s
      )
      .join(", ");
    if (srcLabel) out(1, "NOTE", `Sources: ${srcLabel}`);
    if (n.matchScore != null && (n.sources || []).includes("wikidata")) {
      out(1, "NOTE", `Cross-source match confidence: ${Math.round(n.matchScore * 100)}%`);
    }
    if (n.url) out(1, "NOTE", `WikiTree: ${n.url}`);
    if (n.wikidataUrl) out(1, "NOTE", `Wikidata: ${n.wikidataUrl}`);
    for (const r of (n.records || []).slice(0, 3)) {
      const desc = [r.eventType, r.eventDate, r.eventPlace].filter(Boolean).join(", ");
      out(1, "NOTE", `Open Archives record: ${desc}${r.archive ? ` (${r.archive})` : ""}${r.url ? ` ${r.url}` : ""}`);
    }
  }

  // Families
  for (const [key, fam] of famList) {
    out(0, `${famXref.get(key)} FAM`);
    const parents = [...fam.parents].map((id) => tree.persons.get(id)).filter(Boolean);
    const husband = parents.find((p) => sexOf(p.gender) === "M") || parents[0];
    const wife = parents.find((p) => p !== husband && sexOf(p.gender) === "F") ||
      parents.find((p) => p !== husband);
    if (husband) out(1, "HUSB", indiXref.get(husband.id));
    if (wife) out(1, "WIFE", indiXref.get(wife.id));
    for (const cid of fam.children) out(1, "CHIL", indiXref.get(cid));
  }

  out(0, "TRLR");
  return lines.join("\n") + "\n";
}

// ---------- helpers ----------

function emitEvent(out, tag, date, place) {
  const d = gedcomDate(date);
  if (!d && !place) return;
  out(1, tag);
  if (d) out(2, "DATE", d);
  if (place) out(2, "PLAC", place);
}

function nameParts(n) {
  let given = (n.firstName || "").trim();
  let surname = (n.lastName || "").trim();
  if (!given && !surname && n.name) {
    const toks = n.name.trim().split(/\s+/);
    surname = toks.pop() || "";
    given = toks.join(" ");
  }
  return { given, surname };
}

function sexOf(gender) {
  const g = (gender || "").trim().toUpperCase();
  if (g.startsWith("M")) return "M";
  if (g.startsWith("F")) return "F";
  return "";
}

function gedcomDate(d) {
  if (!d) return "";
  const s = String(d).trim();
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (m) {
    const [, y, mo, da] = m;
    if (mo && da) return `${Number(da)} ${MONTHS[Number(mo) - 1]} ${y}`;
    if (mo) return `${MONTHS[Number(mo) - 1]} ${y}`;
    return y;
  }
  return s; // free-form like "Abt 1835" — GEDCOM importers accept text dates
}

// GEDCOM line values must be single-line. Xref pointers (@I1@) pass through
// untouched; in free text a literal @ is escaped as @@.
function clean(v) {
  const s = String(v).replace(/\s+/g, " ").trim();
  if (/^@[^@\s]+@$/.test(s)) return s; // xref pointer — leave intact
  return s.replace(/@/g, "@@");
}
