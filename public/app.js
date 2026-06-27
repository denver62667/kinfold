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
let lastResults = [];    // flat list of records for CSV export

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
  const groupList = $("#groupList");
  groupList.innerHTML = "";
  lastResults = [];

  const groups = data.groups || [];
  const totalShown = groups.reduce((n, g) => n + (g.results ? g.results.length : 0), 0);
  $("#resultCount").textContent = totalShown ? `(${totalShown} shown)` : "";

  if (!totalShown && !groups.some((g) => g.error)) {
    groupList.appendChild(el("div", "loading",
      "No records matched across the chosen sources. Try just a surname, widen the years, or drop the place."));
    $("#exportBtn").hidden = true;
    return;
  }

  for (const g of groups) {
    const section = el("section", `group acc-${g.accent || "records"}`);
    const head = el("div", "group-head");
    const count = g.error ? "" : `<span class="count">${g.results.length}${g.total > g.results.length ? " of " + g.total : ""}</span>`;
    head.innerHTML = `<span class="group-name">${esc(g.label || g.source)}</span> ${count}`;
    section.appendChild(head);

    if (g.error) {
      section.appendChild(el("div", "group-note", `Source unavailable — ${esc(g.error)}`));
    } else if (!g.results.length) {
      section.appendChild(el("div", "group-note", "No matches from this source."));
    } else {
      for (const r of g.results) {
        section.appendChild(recordCard(r, g.accent));
        lastResults.push({ ...r, sourceLabel: g.label });
      }
    }
    groupList.appendChild(section);
  }

  $("#exportBtn").hidden = lastResults.length === 0;
}

function recordCard(r, accent) {
  const card = el("article", `record-card acc-${accent || "records"}`);
  const meta = [r.eventType, r.eventDate, r.eventPlace].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
  const src = [r.sourceType, r.archive].filter(Boolean).map(esc).join(" — ");
  const pct = Math.round((r.score || 0) * 100);
  card.innerHTML = `
    ${src ? `<span class="rc-collection">${src}</span>` : ""}
    <span class="rc-name">${esc(r.name || "Untitled record")}</span>
    ${meta ? `<div class="rc-vitals">${meta}</div>` : ""}
    ${r.role ? `<div class="rc-related"><span class="tag"><b>Role</b> ${esc(r.role)}</span></div>` : ""}
    ${r.snippet ? `<p class="rc-snippet">${esc(r.snippet)}</p>` : ""}
    <div class="rc-foot">
      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">View source ↗</a>` : "<span></span>"}
      <span class="rc-score" title="relevance to your search">${pct}% match</span>
    </div>`;
  return card;
}

// ---------- CSV export (a research log of what was found) ----------
$("#exportBtn").addEventListener("click", () => {
  if (!lastResults.length) return;
  const cols = ["sourceLabel", "name", "role", "eventType", "eventDate", "eventPlace", "archive", "score", "url", "snippet"];
  const head = ["source", "name", "role", "event", "date", "place", "archive", "relevance", "url", "snippet"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = lastResults.map((r) => cols.map((c) => cell(r[c])).join(","));
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
