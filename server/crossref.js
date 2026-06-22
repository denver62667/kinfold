// server/crossref.js
// Reconcile a WikiTree person against a Wikidata person fact-by-fact, producing a
// row-per-fact table the dossier renders. Pure function (no I/O) — self-testable.
// Status per row: match | conflict | wikitree-only | wikidata-only | none.

function year(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

function normPlace(place) {
  if (!place) return "";
  return place.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

const sameish = (a, b) => a === b || (a && b && (a.includes(b) || b.includes(a)));

// Name comparison is token-aware: "Samuel Langhorne Clemens" and "Samuel Clemens"
// are the same person (every token of the shorter name appears in the longer),
// not a conflict. Falls back to substring for single-token edge cases.
function namesMatch(a, b) {
  if (!a || !b) return false;
  if (sameish(a, b)) return true;
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  return short.length > 0 && short.every((t) => longSet.has(t));
}

function statusFor(wtVal, wdVal, comparator = (a, b) => a === b) {
  const hasWt = Boolean(wtVal);
  const hasWd = Boolean(wdVal);
  if (hasWt && hasWd) return comparator(wtVal, wdVal) ? "match" : "conflict";
  if (hasWt) return "wikitree-only";
  if (hasWd) return "wikidata-only";
  return "none";
}

// The Name row matches against the Wikidata label AND its aliases, so a person
// recorded under a pen/maiden name still reads as a match — and we display the
// alias that actually matched rather than a confusing display label.
function nameRow(wt, wd) {
  const wtName = wt?.name || "";
  const label = wd?.name || "";
  const aliases = (wd?.aliases || []).filter(Boolean);
  const wl = wtName.toLowerCase();
  let status, shown = label;
  if (!wtName && !label && !aliases.length) status = "none";
  else if (!label && !aliases.length) status = "wikitree-only";
  else if (!wtName) status = "wikidata-only";
  else if (namesMatch(wl, label.toLowerCase())) status = "match";
  else {
    const alias = aliases.find((a) => namesMatch(wl, a.toLowerCase()));
    if (alias) { status = "match"; shown = alias; }
    else status = "conflict";
  }
  return { label: "Name", wikitree: wtName, wikidata: shown, status };
}

export function reconcile(wt, wd) {
  const rows = [
    nameRow(wt, wd),
    {
      label: "Birth year",
      wikitree: year(wt?.birthDate) || "",
      wikidata: year(wd?.birthDate) || "",
      status: statusFor(year(wt?.birthDate), year(wd?.birthDate))
    },
    {
      label: "Birth place",
      wikitree: wt?.birthPlace || "",
      wikidata: wd?.birthPlace || "",
      status: statusFor(normPlace(wt?.birthPlace), normPlace(wd?.birthPlace), sameish)
    },
    {
      label: "Death year",
      wikitree: year(wt?.deathDate) || "",
      wikidata: year(wd?.deathDate) || "",
      status: statusFor(year(wt?.deathDate), year(wd?.deathDate))
    },
    {
      label: "Death place",
      wikitree: wt?.deathPlace || "",
      wikidata: wd?.deathPlace || "",
      status: statusFor(normPlace(wt?.deathPlace), normPlace(wd?.deathPlace), sameish)
    }
  ];

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return { rows, counts };
}
