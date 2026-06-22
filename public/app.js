// public/app.js — talks only to our backend (never directly to the APIs).

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const matchesEl = $("#matches");
const matchListEl = $("#matchList");
const dossierEl = $("#dossier");
const messageEl = $("#message");

let agentSnapshot = null;

// ---------- tabs ----------
function showView(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.view === name);
  }
  $("#view-tree").hidden = name !== "tree";
  $("#view-records").hidden = name !== "records";
  $("#view-agent").hidden = name !== "agent";
  if (name === "records") renderRecordsGate();
  if (name === "agent") agentInit();
}
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => showView(tab.dataset.view))
);

// ===================== TREE VIEW =====================
$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessage();
  dossierEl.hidden = true;
  const params = new URLSearchParams({
    firstName: $("#firstName").value.trim(),
    lastName: $("#lastName").value.trim(),
    birthDate: $("#birthDate").value.trim()
  });
  matchesEl.hidden = false;
  matchListEl.innerHTML = '<div class="loading">Searching the open tree…</div>';
  try {
    const { matches } = await (await fetch(`/api/wikitree/search?${params}`)).json();
    renderMatches(matches || []);
  } catch (err) {
    showMessage("WikiTree search failed: " + err.message);
    matchesEl.hidden = true;
  }
});

function renderMatches(matches) {
  $("#matchCount").textContent = matches.length ? `(${matches.length})` : "";
  matchListEl.innerHTML = "";
  if (!matches.length) {
    matchListEl.appendChild(el("div", "loading", "No public profiles matched. Try fewer details."));
    return;
  }
  for (const m of matches) {
    const card = el("button", "match-card");
    const span = (m.birthDate || "—") + " – " + (m.deathDate || "—");
    card.innerHTML = `
      <span>
        <span class="mc-name">${esc(m.name || "Unknown")}</span><br />
        <span class="mc-id">${esc(m.wikitreeId || "")}</span>
      </span>
      <span class="mc-meta">${esc(span)}<br />${esc(m.birthPlace || "")}</span>`;
    card.addEventListener("click", () => openDossier(m.wikitreeId));
    matchListEl.appendChild(card);
  }
}

async function openDossier(key) {
  hideMessage();
  dossierEl.hidden = false;
  dossierEl.innerHTML = '<div class="loading">Opening file…</div>';
  dossierEl.scrollIntoView({ behavior: "smooth", block: "start" });

  let profile, relatives;
  try {
    ({ profile, relatives } = await (await fetch(`/api/wikitree/profile/${encodeURIComponent(key)}`)).json());
  } catch (err) {
    dossierEl.innerHTML = "";
    showMessage("Could not open profile: " + err.message);
    return;
  }

  renderDossier(profile, relatives);
  loadCrossSource(key);
}

// Dig deeper: reconcile this WikiTree person against Wikidata and corroborate with
// Open Archives (+ Europeana) — so opening a person uses every source, not just WikiTree.
async function loadCrossSource(key) {
  const wrap = $("#crossSource");
  if (!wrap) return;
  try {
    const data = await postJSON("/api/crossref", { wikitreeKey: key });
    renderCrossSource(data);
  } catch (err) {
    wrap.innerHTML = `<div class="cs-empty">Couldn't cross-reference: ${esc(err.message)}</div>`;
  }
}

function renderCrossSource(data) {
  const wrap = $("#crossSource");
  if (!wrap) return;
  wrap.innerHTML = "";
  wrap.appendChild(el("h3", "cs-label", "Cross-source reconciliation"));

  const wd = data.wikidata, m = data.match, rec = data.reconciliation;
  const wdPanel = el("div", "cs-wd");
  if (wd && rec) {
    const pct = Math.round((m.score || 0) * 100);
    wdPanel.innerHTML = `
      <div class="cs-srcline">
        <span class="src src-wikidata">WD</span>
        <span class="cs-srcname">Wikidata — ${esc(wd.name || "?")}</span>
        <span class="cs-score${m.conflict ? " bad" : ""}">${pct}%${m.conflict ? " · date conflict" : ""}</span>
        ${wd.url ? `<a class="cs-link" href="${esc(wd.url)}" target="_blank" rel="noopener">view ↗</a>` : ""}
      </div>
      <table class="cs-table">
        <thead><tr><th></th><th>WikiTree</th><th>Wikidata</th></tr></thead>
        <tbody>
          ${rec.rows.map((r) =>
            `<tr class="cs-${r.status}"><td class="cs-fact">${esc(r.label)}</td><td>${esc(r.wikitree || "—")}</td><td>${esc(r.wikidata || "—")}</td></tr>`
          ).join("")}
        </tbody>
      </table>`;
  } else {
    wdPanel.innerHTML = `<div class="cs-empty"><span class="src src-wikidata">WD</span> No confident Wikidata match for this person.</div>`;
  }
  wrap.appendChild(wdPanel);

  const recs = data.records || [];
  const recPanel = el("div", "cs-records");
  if (recs.length) {
    recPanel.appendChild(el("div", "cs-sub", "Corroborating records"));
    for (const r of recs) {
      const evt = [r.eventType, r.eventDate, r.eventPlace].filter(Boolean).map(esc).join(" · ");
      const card = el("div", `cs-rec prov-${r.source}`);
      card.innerHTML = `
        <span class="src ${r.source === "europeana" ? "src-europeana" : "src-openarchives"}">${r.source === "europeana" ? "EU" : "OA"}</span>
        <span class="cs-rec-body">
          <span class="cs-rec-name">${esc(r.name || "Record")}</span>
          ${evt ? `<span class="cs-rec-meta">${evt}</span>` : ""}
        </span>
        <span class="cs-rec-score">${Math.round((r.score || 0) * 100)}%</span>
        ${r.url ? `<a class="cs-link" href="${esc(r.url)}" target="_blank" rel="noopener">↗</a>` : ""}`;
      recPanel.appendChild(card);
    }
  } else {
    recPanel.innerHTML = `<div class="cs-empty">No corroborating records matched${europeanaAvailable ? " in Open Archives or Europeana" : " in Open Archives"}.</div>`;
  }
  wrap.appendChild(recPanel);
}

function renderDossier(p, relatives) {
  dossierEl.innerHTML = "";

  const head = el("div", "dossier-head");
  head.innerHTML = `
    <div class="eyebrow2">Subject file · WikiTree ${esc(p.wikitreeId)}</div>
    <h2>${esc(p.name || "Unknown")}</h2>
    <div class="vitals">
      ${esc(p.birthDate || "?")}${p.birthPlace ? " · " + esc(p.birthPlace) : ""}
      &nbsp;→&nbsp;
      ${esc(p.deathDate || "?")}${p.deathPlace ? " · " + esc(p.deathPlace) : ""}
      &nbsp;|&nbsp; <a href="${esc(p.url)}" target="_blank" rel="noopener">open on WikiTree ↗</a>
    </div>`;
  // Handoff: jump to records search pre-filled for this person.
  const findBtn = el("button", "btn-handoff", "Find historical records ↗");
  findBtn.addEventListener("click", () => handoffToRecords(p));
  head.appendChild(findBtn);
  const buildBtn = el("button", "btn-handoff", "Build tree from here →");
  buildBtn.addEventListener("click", () => startAgentFromDossier(p.wikitreeId));
  head.appendChild(buildBtn);
  dossierEl.appendChild(head);

  const panels = el("div", "panels");
  panels.appendChild(relativesPanel(relatives));
  panels.appendChild(bioPanel(p));
  dossierEl.appendChild(panels);

  // Placeholder filled in by loadCrossSource() once the other sources respond.
  const cs = el("section", "cross-source");
  cs.id = "crossSource";
  cs.innerHTML = '<div class="loading">Cross-referencing across Wikidata, Open Archives' +
    (europeanaAvailable ? " &amp; Europeana" : "") + "…</div>";
  dossierEl.appendChild(cs);
}

function relativesPanel(rel) {
  const panel = el("div", "panel");
  panel.appendChild(el("h3", null, "Relatives"));
  if (!rel) {
    panel.appendChild(el("div", "loading", "No relatives returned."));
    return panel;
  }
  const group = (label, people) => {
    if (!people || !people.length) return;
    const g = el("div", "rel-group");
    g.appendChild(el("div", "rg-label", label));
    const ul = el("ul");
    for (const person of people) {
      const li = el("li");
      li.innerHTML = `<a href="https://www.wikitree.com/wiki/${esc(person.wikitreeId)}" target="_blank" rel="noopener">${esc(person.name || person.wikitreeId)}</a>`;
      ul.appendChild(li);
    }
    g.appendChild(ul);
    panel.appendChild(g);
  };
  group("Parents", rel.parents);
  group("Spouses", rel.spouses);
  group("Children", rel.children);
  group("Siblings", rel.siblings);
  return panel;
}

function bioPanel(p) {
  const panel = el("div", "panel");
  panel.appendChild(el("h3", null, "Biography"));
  panel.appendChild(el("div", "bio",
    p.bio ? p.bio : '<span class="loading">No biography on the WikiTree profile.</span>'));
  return panel;
}

// ===================== RECORDS VIEW =====================
// Records come from Open Archives (free, no auth) or — if a free API key is
// configured server-side — Europeana (pan-European archives incl. UK & Germany).
function renderRecordsGate() {
  $("#recordsForm").hidden = false;
  $("#oaHint").hidden = false;
  ensureSourceToggle();
}

// Reveal the Europeana option only when the server reports a key is configured,
// and wire the source <select> to the country field + hint text. Runs once.
let europeanaAvailable = false;
async function ensureSourceToggle() {
  if (ensureSourceToggle.done) return;
  ensureSourceToggle.done = true;
  const sel = $("#recSource");
  if (sel) sel.addEventListener("change", onRecordSourceChange);
  try {
    const s = await (await fetch("/api/sources")).json();
    europeanaAvailable = !!(s && s.europeana);
  } catch { /* offline: leave Europeana hidden */ }
  const opt = $("#recSourceEuropeana");
  if (opt) { opt.hidden = !europeanaAvailable; opt.disabled = !europeanaAvailable; }
  onRecordSourceChange();
}

function currentRecordSource() {
  const sel = $("#recSource");
  return sel ? sel.value : "openarchives";
}

function onRecordSourceChange() {
  const eu = currentRecordSource() === "europeana";
  const cf = $("#recCountryField");
  if (cf) cf.hidden = !eu;
  $("#oaHint").textContent = eu
    ? "Searches Europeana — free pan-European archives & heritage records (UK incl. Scotland, Germany, and more). Needs a name; country narrows results."
    : "Searches Open Archives — free Dutch, Belgian and French records. No login needed; uses name and place.";
}

$("#recordsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  runRecordSearch();
});

const RECORD_PAGE_SIZE = 20;

function runRecordSearch(opts = {}) {
  return currentRecordSource() === "europeana"
    ? runEuropeanaSearch(opts)
    : runOpenArchSearch(opts);
}

function renderPager(total, offset) {
  const pager = $("#recordPager");
  pager.innerHTML = "";
  const shown = $("#recordList").querySelectorAll(".record-card").length;
  if (!shown) { pager.hidden = true; return; }
  pager.hidden = false;

  const start = offset + 1;
  const end = offset + shown;
  const cap = Math.max(total, end);
  const hasMore = end < cap;

  const prev = el("button", "pager-btn", "← Previous");
  prev.disabled = offset <= 0;
  prev.addEventListener("click", () =>
    runRecordSearch({ reset: false, offset: Math.max(0, offset - RECORD_PAGE_SIZE) }));

  const label = el("span", "pager-label", `${start}–${end} of ${cap}`);

  const next = el("button", "pager-btn", "Next →");
  next.disabled = !hasMore;
  next.addEventListener("click", () =>
    runRecordSearch({ reset: false, offset: offset + RECORD_PAGE_SIZE }));

  pager.appendChild(prev);
  pager.appendChild(label);
  pager.appendChild(next);
}

// ---------- Open Archives provider ----------
async function runOpenArchSearch({ offset = 0 } = {}) {
  hideRecordsMessage();
  const given = $("#recGiven").value.trim();
  const surname = $("#recSurname").value.trim();
  if (!given && !surname) {
    showRecordsMessage("Enter a name to search Open Archives.");
    return;
  }

  const params = new URLSearchParams({
    given,
    surname,
    place: $("#recBirthPlace").value.trim(),
    count: String(RECORD_PAGE_SIZE),
    start: String(offset)
  });

  const recordsEl = $("#records");
  const listEl = $("#recordList");
  recordsEl.hidden = false;
  if (offset > 0) recordsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  listEl.innerHTML = '<div class="loading">Searching Open Archives…</div>';
  $("#recordPager").hidden = true;

  try {
    const res = await fetch(`/api/openarchives/search?${params}`);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderRecordCards(data, "openarchives");
    renderPager(data.total || 0, offset);
  } catch (err) {
    listEl.innerHTML = "";
    $("#recordPager").hidden = true;
    showRecordsMessage("Open Archives search failed: " + err.message);
  }
}

// ---------- Europeana provider (free API key; UK incl. Scotland, Germany, EU) ----------
async function runEuropeanaSearch({ offset = 0 } = {}) {
  hideRecordsMessage();
  const given = $("#recGiven").value.trim();
  const surname = $("#recSurname").value.trim();
  if (!given && !surname) {
    showRecordsMessage("Enter a name to search Europeana.");
    return;
  }

  const params = new URLSearchParams({
    given,
    surname,
    place: $("#recBirthPlace").value.trim(),
    country: ($("#recCountry") && $("#recCountry").value) || "",
    count: String(RECORD_PAGE_SIZE),
    start: String(offset)
  });

  const recordsEl = $("#records");
  const listEl = $("#recordList");
  recordsEl.hidden = false;
  if (offset > 0) recordsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  listEl.innerHTML = '<div class="loading">Searching Europeana…</div>';
  $("#recordPager").hidden = true;

  try {
    const res = await fetch(`/api/europeana/search?${params}`);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderRecordCards(data, "europeana");
    renderPager(data.total || 0, offset);
  } catch (err) {
    listEl.innerHTML = "";
    $("#recordPager").hidden = true;
    showRecordsMessage("Europeana search failed: " + err.message);
  }
}

const RECORD_SOURCE_LABEL = {
  openarchives: "Open Archives",
  europeana: "Europeana"
};

function renderRecordCards(data, provider = "openarchives") {
  const listEl = $("#recordList");
  const label = RECORD_SOURCE_LABEL[provider] || "the source";
  $("#recordCount").textContent = data.total ? `(${data.total})` : "";
  listEl.innerHTML = "";
  if (!data.results || !data.results.length) {
    listEl.appendChild(el("div", "loading", `No ${label} records matched. Try just a surname, or add a place.`));
    return;
  }
  for (const r of data.results) {
    const card = el("div", `record-card prov-${provider}`);
    const eventLine = [r.eventType, r.eventDate, r.eventPlace]
      .filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
    const src = [r.sourceType, r.archive].filter(Boolean).map(esc).join(" — ");
    card.innerHTML = `
      ${src ? `<span class="rc-collection">${src}</span>` : ""}
      <span class="rc-name">${esc(r.name || "Unknown")}</span>
      ${eventLine ? `<div class="rc-vitals">${eventLine}</div>` : ""}
      ${r.role ? `<div class="rc-related"><span class="tag"><b>Role</b> ${esc(r.role)}</span></div>` : ""}
      <div class="rc-foot">
        ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">View on ${esc(label)} ↗</a>` : "<span></span>"}
      </div>`;
    listEl.appendChild(card);
  }
}

// Pre-fill the records form from a dossier person, switch tabs, and search.
function handoffToRecords(p) {
  $("#recGiven").value = p.firstName || "";
  $("#recSurname").value = p.lastName || "";
  $("#recBirthPlace").value = p.birthPlace || "";
  showView("records");
  if (p.firstName || p.lastName) runRecordSearch();
}

// ===================== AUTO-BUILD (AGENT) =====================
async function agentInit() {
  if (agentSnapshot) { renderAgent(agentSnapshot); return; }
  try {
    const snap = await (await fetch("/api/agent/tree")).json();
    if (snap) renderAgent(snap);
  } catch { /* nothing yet */ }
}

$("#agentStartBtn").addEventListener("click", () => {
  const seed = $("#agentSeed").value.trim();
  if (!seed) {
    showAgentMessage("Enter a WikiTree ID (e.g. Clemens-1), or use 'Build tree from here' on a profile.");
    return;
  }
  startAgent(seed, Number($("#agentGens").value));
});

function startAgentFromDossier(wikitreeKey) {
  $("#agentSeed").value = wikitreeKey;
  agentSnapshot = null;
  showView("agent");
  startAgent(wikitreeKey, Number($("#agentGens").value));
}

async function startAgent(wikitreeKey, generations) {
  hideAgentMessage();
  $("#agentStatus").hidden = false;
  $("#agentStatus").innerHTML = '<div class="loading">Building the tree…</div>';
  $("#agentQuestions").hidden = true;
  $("#agentTree").hidden = true;
  try {
    const snap = await postJSON("/api/agent/start", {
      wikitreeKey,
      settings: {
        maxGenerations: generations,
        useWikidata: $("#agentWD").checked,
        useOpenArchives: $("#agentOA").checked
      }
    });
    renderAgent(snap);
  } catch (err) {
    $("#agentStatus").hidden = true;
    showAgentMessage("Couldn't start: " + err.message);
  }
}

async function agentContinue() {
  const btn = $("#agentContinueBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
  try {
    renderAgent(await postJSON("/api/agent/continue", {}));
  } catch (err) {
    showAgentMessage("Continue failed: " + err.message);
  }
}

async function agentAnswer(questionId, value) {
  try {
    renderAgent(await postJSON("/api/agent/answer", { questionId, value }));
  } catch (err) {
    showAgentMessage("Couldn't record answer: " + err.message);
  }
}

function renderAgent(snap) {
  agentSnapshot = snap;
  if (!snap) return;
  hideAgentMessage();

  const st = $("#agentStatus");
  st.hidden = false;
  const c = snap.counts;
  const stateLabel = { running: "more to explore", waiting: "waiting on you", done: "complete" }[snap.status] || snap.status;
  st.innerHTML = `
    <div class="as-stats">
      <span><b>${c.persons}</b> people</span>
      <span><b>${c.matched}</b> cross-source matches</span>
      <span><b>${c.questions}</b> open questions</span>
    </div>
    <div class="as-actions">
      ${c.persons ? `<a class="btn-handoff" href="/api/agent/gedcom" download="kinfold-tree.ged">Export GEDCOM ↓</a>` : ""}
      <span class="as-state as-${snap.status}">${stateLabel}</span>
      ${snap.status === "running" ? `<button id="agentContinueBtn" class="btn-primary">Continue building</button>` : ""}
    </div>`;
  const cont = $("#agentContinueBtn");
  if (cont) cont.addEventListener("click", agentContinue);

  renderAgentQuestions(snap.questions);
  renderAgentTree(snap.persons, snap.rootId);
}

function renderAgentQuestions(questions) {
  const wrap = $("#agentQuestions");
  wrap.innerHTML = "";
  if (!questions || !questions.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  wrap.appendChild(el("h2", "section-label", `Questions <span class="count">(${questions.length})</span>`));

  for (const q of questions) {
    const p = q.person || {}, cand = q.candidate || {};
    const card = el("div", "q-card");
    const line = (o) =>
      `${esc(o.birthDate || "?")}${o.birthPlace ? " · " + esc(o.birthPlace) : ""}${o.deathDate ? " → " + esc(o.deathDate) : ""}`;
    card.innerHTML = `
      <div class="q-prompt">${esc(q.prompt)} ${q.conflict ? '<span class="q-flag">date conflict</span>' : ""}</div>
      <div class="q-compare">
        <div class="q-side q-wt">
          <div class="q-src">WikiTree · ${esc(p.relation || "")}</div>
          <div class="q-name">${esc(p.name || "?")}</div>
          <div class="q-meta">${line(p)}</div>
        </div>
        <div class="q-mid"><span class="q-score">${Math.round((q.score || 0) * 100)}%</span></div>
        <div class="q-side q-cand">
          <div class="q-src">Wikidata</div>
          <div class="q-name">${esc(cand.name || "?")}</div>
          <div class="q-meta">${line(cand)}</div>
          ${cand.url ? `<a class="q-link" href="${esc(cand.url)}" target="_blank" rel="noopener">view ↗</a>` : ""}
        </div>
      </div>
      ${q.runnerUp ? `<div class="q-runner">Another close candidate: ${esc(q.runnerUp.name || "?")} (${esc(q.runnerUp.birthDate || "?")})</div>` : ""}
      <div class="q-options"></div>`;
    const opts = card.querySelector(".q-options");
    for (const o of q.options) {
      const b = el("button", "q-opt", esc(o.label));
      b.addEventListener("click", () => agentAnswer(q.id, o.value));
      opts.appendChild(b);
    }
    wrap.appendChild(card);
  }
}

function renderAgentTree(persons, rootId) {
  const wrap = $("#agentTree");
  wrap.innerHTML = "";
  if (!persons || !persons.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  wrap.appendChild(el("h2", "section-label", "Tree so far"));

  const byGen = {};
  for (const p of persons) (byGen[p.generation] ||= []).push(p);
  const gens = Object.keys(byGen).map(Number).sort((a, b) => b - a);

  for (const g of gens) {
    const sec = el("div", "gen-group");
    sec.appendChild(el("div", "gen-label", genLabel(g)));
    const grid = el("div", "person-grid");
    for (const p of byGen[g]) grid.appendChild(personChip(p, p.id === rootId));
    sec.appendChild(grid);
    wrap.appendChild(sec);
  }
}

function genLabel(g) {
  if (g === 0) return "Anchor & immediate family";
  if (g < 0) return g === -1 ? "Children" : "Descendants";
  if (g === 1) return "Parents";
  if (g === 2) return "Grandparents";
  if (g === 3) return "Great-grandparents";
  return `${g - 2}× great-grandparents`;
}

function personChip(p, isRoot) {
  const matched = p.sources.includes("wikidata");
  const tier = matched ? "matched" : p.matchScore != null ? "review" : "single";
  const chip = el("div", `person-chip pc-${tier}${isRoot ? " is-root" : ""}`);
  const years = `${p.birthDate || "?"}${p.deathDate ? "–" + p.deathDate : ""}`;
  const label = (s) =>
    s === "wikitree" ? "WT"
    : s === "wikidata" ? "WD"
    : "OA";
  const srcChips = p.sources.map((s) => `<span class="src src-${s}">${label(s)}</span>`).join("");
  const nameHtml = p.wikitreeUrl
    ? `<a class="pc-name" href="${esc(p.wikitreeUrl)}" target="_blank" rel="noopener">${esc(p.name || "Unknown")}</a>`
    : `<span class="pc-name">${esc(p.name || "Unknown")}</span>`;
  const firstRec = (p.records || [])[0];
  const recsHtml = p.recordCount
    ? `<div class="pc-records">${p.recordCount} Open Archives record${p.recordCount > 1 ? "s" : ""}${firstRec && firstRec.url ? ` · <a href="${esc(firstRec.url)}" target="_blank" rel="noopener">view ↗</a>` : ""}</div>`
    : "";

  chip.innerHTML = `
    <div class="pc-top">${nameHtml}<span class="pc-rel">${esc(p.relation)}</span></div>
    <div class="pc-years">${esc(years)}${p.birthPlace ? " · " + esc(p.birthPlace) : ""}</div>
    <div class="pc-foot">
      <span class="pc-src">${srcChips}</span>
      ${matched && p.matchScore != null ? `<span class="pc-score ok">${Math.round(p.matchScore * 100)}% match</span>` : ""}
      ${!matched && p.matchScore != null ? `<span class="pc-score">needs review</span>` : ""}
    </div>
    ${recsHtml}`;
  return chip;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(error || `HTTP ${res.status}`);
  }
  return res.json();
}

function showAgentMessage(t) { const m = $("#agentMessage"); m.hidden = false; m.textContent = t; }
function hideAgentMessage() { const m = $("#agentMessage"); m.hidden = true; m.textContent = ""; }

// ---------- messages ----------
function showMessage(t) { messageEl.hidden = false; messageEl.textContent = t; }
function hideMessage() { messageEl.hidden = true; messageEl.textContent = ""; }
function showRecordsMessage(t) { const m = $("#recordsMessage"); m.hidden = false; m.textContent = t; }
function hideRecordsMessage() { const m = $("#recordsMessage"); m.hidden = true; m.textContent = ""; }

// init
renderRecordsGate();
ensureSourceToggle(); // learn which optional sources (Europeana) are configured
