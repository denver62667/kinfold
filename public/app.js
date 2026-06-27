// public/app.js — talks only to our backend (never directly to the archives).
// Kinfold is a document-first people search: one query fans out across every chosen
// source, and the strongest matches per source are shown as evidence to weigh.

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let SOURCES = [];        // [{ id, label, accent, region, description }]
let lastGroups = [];     // raw response groups (for the by-source view)
let ranked = [];         // every record, source-tagged and sorted by score desc
let lastResults = [];    // flat list of records for CSV export (== ranked)
let resultsView = "best"; // "best" (cross-source, ranked) | "source" (grouped)
let minScore = 0;        // relevance threshold (0..1) from the slider

// ---------- sources ----------
async function loadSources() {
  const wrap = $("#sourceList");
  try {
    const { sources } = await (await fetch("/api/sources")).json();
    SOURCES = sources || [];
  } catch {
    wrap.innerHTML = '<span class="loading">Couldn\'t load sources.</span>';
    return;
  }
  wrap.innerHTML = "";
  for (const s of SOURCES) {
    const id = `src-${s.id}`;
    const lab = el("label", `source-toggle acc-${s.accent}`);
    lab.innerHTML = `
      <input type="checkbox" id="${id}" value="${esc(s.id)}" checked />
      <span class="st-body">
        <span class="st-name">${esc(s.label)} <span class="st-region">${esc(s.region || "")}</span></span>
        <span class="st-desc">${esc(s.description || "")}</span>
      </span>`;
    wrap.appendChild(lab);
  }
}

function selectedSources() {
  return [...document.querySelectorAll("#sourceList input:checked")].map((i) => i.value);
}

// ---------- search ----------
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
});

async function runSearch() {
  hideMessage();
  const given = $("#given").value.trim();
  const surname = $("#surname").value.trim();
  if (!given && !surname) {
    showMessage("Enter a name — at least a surname — to search.");
    return;
  }
  const sources = selectedSources();
  if (!sources.length) {
    showMessage("Pick at least one source to search.");
    return;
  }

  const params = new URLSearchParams({
    given, surname,
    place: $("#place").value.trim(),
    from: $("#fromYear").value.trim(),
    to: $("#toYear").value.trim(),
    sources: sources.join(","),
    count: "20"
  });

  const resultsEl = $("#results");
  const groupList = $("#groupList");
  resultsEl.hidden = false;
  $("#exportBtn").hidden = true;
  groupList.innerHTML = '<div class="loading">Searching ' + sources.length +
    ' source' + (sources.length > 1 ? "s" : "") + "…</div>";

  try {
    const res = await fetch(`/api/search?${params}`);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `HTTP ${res.status}`);
    }
    renderResults(await res.json());
  } catch (err) {
    groupList.innerHTML = "";
    showMessage("Search failed: " + err.message);
  }
}

function renderResults(data) {
  lastGroups = data.groups || [];

  // Flatten every record across sources, tag it with its source's label/accent, and
  // rank by relevance — the basis for the "best matches" view (and CSV export).
  ranked = [];
  for (const g of lastGroups) {
    for (const r of g.results || []) {
      ranked.push({ ...r, _label: g.label || g.source, _accent: g.accent || "records" });
    }
  }
  ranked.sort((a, b) => (b.score || 0) - (a.score || 0));
  lastResults = ranked.map((r) => ({ ...r, sourceLabel: r._label }));

  const total = ranked.length;
  const hasErrors = lastGroups.some((g) => g.error);
  $("#viewToggle").hidden = total === 0;
  $("#thresholdWrap").hidden = total === 0;
  $("#exportBtn").hidden = total === 0;

  if (!total && !hasErrors) {
    $("#resultCount").textContent = "";
    $("#groupList").innerHTML = "";
    $("#groupList").appendChild(el("div", "loading",
      "No records matched across the chosen sources. Try just a surname, widen the years, or drop the place."));
    return;
  }
  renderResultsView();
}

const aboveThreshold = (r) => (r.score || 0) >= minScore;

// Render whichever view is selected, keep the toggle buttons in sync, and report how
// many records are visible after the relevance threshold.
function renderResultsView() {
  for (const b of document.querySelectorAll(".vt-btn")) {
    b.classList.toggle("is-active", b.dataset.rview === resultsView);
  }
  const shown = resultsView === "best" ? renderBest() : renderBySource();
  const suffix = minScore > 0 ? ` of ${ranked.length}` : "";
  $("#resultCount").textContent = ranked.length ? `(${shown}${suffix} shown)` : "";
}

// Cross-source: one list ranked by relevance, with same-person records from different
// sources collapsed into one card (the strongest is the face; the rest fold into an
// expander). Returns the number of cards shown.
function renderBest() {
  const groupList = $("#groupList");
  groupList.innerHTML = "";
  const clusters = clusterRecords(ranked.filter(aboveThreshold));
  if (clusters.length) {
    const list = el("div", "best-list");
    for (const c of clusters) list.appendChild(recordCard(c.rep, c.rep._accent, c.rep._label, c));
    groupList.appendChild(list);
  } else {
    groupList.appendChild(thresholdEmptyNote());
  }
  appendErrorNotes(groupList);
  return clusters.length;
}

// Grouped: one section per source, each with its own count. Returns total cards shown.
function renderBySource() {
  const groupList = $("#groupList");
  groupList.innerHTML = "";
  let shown = 0;
  for (const g of lastGroups) {
    const section = el("section", `group acc-${g.accent || "records"}`);
    const head = el("div", "group-head");
    const visible = (g.results || []).filter(aboveThreshold);
    shown += visible.length;
    const count = g.error ? "" : `<span class="count">${visible.length}${g.total > g.results.length && minScore === 0 ? " of " + g.total : ""}</span>`;
    head.innerHTML = `<span class="group-name">${esc(g.label || g.source)}</span> ${count}`;
    section.appendChild(head);

    if (g.error) {
      section.appendChild(el("div", "group-note", `Source unavailable — ${esc(g.error)}`));
    } else if (!g.results.length) {
      section.appendChild(el("div", "group-note", "No matches from this source."));
    } else if (!visible.length) {
      section.appendChild(el("div", "group-note", `No matches above ${Math.round(minScore * 100)}%.`));
    } else {
      for (const r of visible) section.appendChild(recordCard(r, g.accent));
    }
    groupList.appendChild(section);
  }
  return shown;
}

function thresholdEmptyNote() {
  return el("div", "loading", `No records at or above ${Math.round(minScore * 100)}% relevance. Lower the threshold to see more.`);
}

// Cluster records that look like the same person: same normalized name + same event
// year. Input is already sorted by score desc, so each cluster's first (strongest)
// record becomes its representative and the rest are kept as duplicates. Records with
// no name are never merged (each stays on its own). Order follows relevance.
function clusterRecords(records) {
  const byKey = new Map();
  const order = [];
  for (const r of records) {
    const key = personKey(r);
    if (key && byKey.has(key)) {
      byKey.get(key).dupes.push(r);
    } else {
      const cluster = { rep: r, dupes: [] };
      if (key) byKey.set(key, cluster);
      order.push(cluster);
    }
  }
  return order;
}

function personKey(r) {
  const name = String(r.name || "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
  if (!name) return ""; // no name → not dedupable
  const year = (String(r.eventDate || "").match(/\b(\d{4})\b/) || [])[1] || "";
  return `${name}|${year}`;
}

// In the best-matches view, sources that failed are summarized at the end so a
// failure isn't silently hidden by the cross-source merge.
function appendErrorNotes(container) {
  const errs = lastGroups.filter((g) => g.error);
  if (!errs.length) return;
  const note = el("div", "group-note err-note",
    "Unavailable: " + errs.map((g) => esc(g.label || g.source)).join(", "));
  container.appendChild(note);
}

function recordCard(r, accent, sourceLabel, cluster) {
  const card = el("article", `record-card acc-${accent || "records"}`);
  const meta = [r.eventType, r.eventDate, r.eventPlace].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
  const src = [r.sourceType, r.archive].filter(Boolean).map(esc).join(" — ");
  const pct = Math.round((r.score || 0) * 100);
  card.innerHTML = `
    <div class="rc-top">
      ${src ? `<span class="rc-collection">${src}</span>` : "<span></span>"}
      ${sourceLabel ? `<span class="rc-source">${esc(sourceLabel)}</span>` : ""}
    </div>
    <span class="rc-name">${esc(r.name || "Untitled record")}</span>
    ${meta ? `<div class="rc-vitals">${meta}</div>` : ""}
    ${r.role ? `<div class="rc-related"><span class="tag"><b>Role</b> ${esc(r.role)}</span></div>` : ""}
    ${r.snippet ? `<p class="rc-snippet">${esc(r.snippet)}</p>` : ""}
    ${dupesHtml(cluster)}
    <div class="rc-foot">
      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">View source ↗</a>` : "<span></span>"}
      <span class="rc-score" title="relevance to your search">${pct}% match</span>
    </div>`;
  return card;
}

// The "also found in" expander for a clustered card — the duplicate records of the
// same person from other sources, each linking out to its own document.
function dupesHtml(cluster) {
  const dupes = cluster && cluster.dupes;
  if (!dupes || !dupes.length) return "";
  const sources = [...new Set(dupes.map((d) => d._label))].map(esc).join(", ");
  const items = dupes.map((d) => {
    const line = [d._label, d.eventType, d.eventDate].filter(Boolean).map(esc).join(" · ");
    const link = d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">view ↗</a>` : "";
    return `<li>${line} ${link}</li>`;
  }).join("");
  const n = dupes.length;
  return `
    <details class="rc-dupes">
      <summary>Also found in ${n} other record${n > 1 ? "s" : ""} — ${sources}</summary>
      <ul>${items}</ul>
    </details>`;
}

// view toggle
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".vt-btn");
  if (!btn || btn.dataset.rview === resultsView) return;
  resultsView = btn.dataset.rview;
  renderResultsView();
});

// relevance threshold slider
$("#threshold").addEventListener("input", (e) => {
  minScore = (Number(e.target.value) || 0) / 100;
  $("#thVal").textContent = `${Math.round(minScore * 100)}%`;
  if (ranked.length) renderResultsView();
});

// ---------- CSV export (a research log of what was found) ----------
$("#exportBtn").addEventListener("click", () => {
  // Export what's currently in scope (threshold-filtered), keeping every source's
  // record — duplicates are distinct links worth logging.
  const out = lastResults.filter(aboveThreshold);
  if (!out.length) return;
  const cols = ["sourceLabel", "name", "role", "eventType", "eventDate", "eventPlace", "archive", "score", "url", "snippet"];
  const head = ["source", "name", "role", "event", "date", "place", "archive", "relevance", "url", "snippet"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = out.map((r) => cols.map((c) => cell(r[c])).join(","));
  const csv = [head.join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kinfold-findings.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

// ---------- messages ----------
function showMessage(t) { const m = $("#message"); m.hidden = false; m.textContent = t; }
function hideMessage() { const m = $("#message"); m.hidden = true; m.textContent = ""; }

// init
loadSources();
