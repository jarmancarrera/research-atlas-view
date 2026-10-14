(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const APP_BASE = new URL("./", document.currentScript.src);
  const NS = "http://www.w3.org/2000/svg";
  const STORE = "emi-observatory.views:";
  const DEFAULTS = ["BRA", "CHN", "IND"];
  const COLORS = ["#b31b1b", "#146b78", "#8b672b"];
  const PLOT = { navy: "#263b45", red: "#b31b1b", blue: "#146b78", grid: "#e8ede9", muted: "#59646a", ink: "#38413e", paper: "#ffffff" };
  const state = {
    data: null, observations: new Map(), years: [], busy: false,
    view: { metric: "", from: 2000, to: 2025, year: 2025, countries: [], mode: "level", baseYear: null, scope: "top12", presentation: "chart", tab: "overview" },
    renders: new WeakMap(), plotRefs: {}
  };

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
  const clear = (node) => node.replaceChildren();
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const metric = () => state.data?.metrics.find((item) => item.id === state.view.metric) || null;
  const country = (id) => state.data?.countries.find((item) => item.id === id) || { id, name: id };
  const name = (id) => country(id).name || id;
  const obs = (id, metricId = state.view.metric, year) => {
    const value = state.observations.get(`${id}|${metricId}|${year}`);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const fmt = (value, digits = 1) => new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value);
  const yearsView = () => state.years.filter((year) => year >= state.view.from && year <= state.view.to);
  const isPercent = (item = metric()) => /%/.test(item?.unit || "");
  const isDollars = (item = metric()) => /US\$|USD|current US/i.test(item?.unit || "");
  const displayUnit = () => state.view.mode === "index" ? "Index points, common positive base year = 100" : metric()?.unit || "Source unit not supplied";

  function displayNumber(value, item = metric()) {
    if (value === null || !Number.isFinite(value)) return "No observation";
    if (isPercent(item)) return `${fmt(value, 2)}%`;
    if (isDollars(item)) return `${value < 0 ? "−" : ""}$${fmt(Math.abs(value), Math.abs(value) < 10 ? 2 : 0)}`;
    return `${fmt(value, Math.abs(value) < 10 ? 2 : 1)}${item?.unit ? ` ${item.unit}` : ""}`;
  }
  function axisNumber(value, item = metric()) {
    if (!Number.isFinite(value)) return "";
    if (isPercent(item)) return `${fmt(value, 1)}%`;
    const amount = Math.abs(value), suffix = amount >= 1e12 ? "T" : amount >= 1e9 ? "B" : amount >= 1e6 ? "M" : amount >= 1e3 ? "k" : "";
    const factor = { T: 1e12, B: 1e9, M: 1e6, k: 1e3 }[suffix] || 1;
    return `${value < 0 ? "−" : ""}${fmt(Math.abs(value) / factor, 1)}${suffix}`;
  }
  function compactNumber(value, item = metric()) {
    if (value === null || !Number.isFinite(value)) return "No observation";
    const number = axisNumber(Math.abs(value), item);
    return `${value < 0 ? "−" : ""}${isDollars(item) ? "$" : ""}${number}`;
  }
  function chartTicks(values, item = metric()) {
    const finite = values.filter((value) => value !== null && Number.isFinite(value));
    if (!finite.length) return {};
    const low = Math.min(0, ...finite), high = Math.max(0, ...finite), rough = (high - low || 1) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough)), normalized = rough / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    const ticks = [];
    for (let value = Math.floor(low / step) * step; value <= high + step * 0.05; value += step) ticks.push(value);
    return { tickmode: "array", tickvals: ticks, ticktext: ticks.map((value) => compactNumber(value, item)) };
  }
  function safeUrl(raw) {
    try { if (typeof raw !== "string" || !raw.trim()) return null; const url = new URL(raw); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  }
  function addLink(parent, raw, label) {
    const href = safeUrl(raw);
    if (!href) { parent.append(el("span", "muted", label)); return; }
    const a = el("a", "", label); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; parent.append(a);
  }
  function date(value) {
    if (typeof value !== "string" || !value) return "Not supplied";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return value;
    return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(parsed)}`;
  }
  function publicText(value) {
    let text = String(value ?? "").split(/\s+\|\s*(?:source|snapshot):/i)[0];
    text = text.replace(/\bwb-[a-f0-9]{12,}\b/gi, "this data version").replace(/\b[a-f0-9]{32,64}\b/gi, "");
    for (const item of state.data?.metrics || []) text = text.split(item.id).join(item.label || "Selected indicator");
    text = text.replace(/\b[A-Z]{3}\b/g, (code) => state.data?.countries.find((item) => item.id === code)?.name || code);
    return text.replace(/snapshot/gi, "data version");
  }
  function setMessage(text, error = false) {
    const node = $("#globalMessage"); node.hidden = !text; node.className = `message${error ? " error" : ""}`; node.textContent = publicText(text);
  }
  function setService(text, mode = "") { $("#loadStatus").textContent = publicText(text); $("#statusDot").className = mode; }
  function validateSnapshot(data, expectedId) {
    if (!data || typeof data.snapshot_id !== "string" || !Array.isArray(data.countries) || !Array.isArray(data.metrics) || !Array.isArray(data.observations)) {
      throw new Error("The published file does not match the Observatory snapshot format.");
    }
    if (expectedId && data.snapshot_id !== expectedId) throw new Error("The saved data version does not match the available release.");
    const observations = new Map();
    for (const row of data.observations) {
      if (!row || typeof row.country !== "string" || typeof row.metric !== "string" || !Number.isInteger(Number(row.year))) continue;
      const value = row.value == null ? null : Number(row.value);
      observations.set(`${row.country}|${row.metric}|${Number(row.year)}`, Number.isFinite(value) ? value : null);
    }
    state.data = data; state.observations = observations;
    const start = Number(data.window?.start), end = Number(data.window?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 300) throw new Error("The snapshot has an invalid observation window.");
    state.years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  function enableControls(enabled) {
    ["metricSelect", "startYear", "endYear", "selectedYear", "countrySearch", "addCountry", "rankingScope", "viewName", "pinSnapshot", "saveView", "exportCsv", "exportSvg", "questionInput", "askButton"].forEach((id) => { $("#" + id).disabled = !enabled; });
    document.querySelectorAll('input[name="seriesMode"]').forEach((input) => { input.disabled = !enabled; });
    $("#loadView").disabled = !$("#savedViews").value || state.busy;
    $("#deleteView").disabled = !$("#savedViews").value;
  }
  function emptyChart(root, text, key = null) {
    root.style.removeProperty("height");
    state.renders.set(root, (state.renders.get(root) || 0) + 1);
    if (key) { state.plotRefs[key] = null; if (key === "timeline") $("#exportSvg").disabled = true; }
    if (window.Plotly) window.Plotly.purge(root);
    root.replaceChildren(el("p", "empty-state", text));
  }
  function clearSnapshot() {
    state.data = null; state.observations.clear(); state.years = []; state.plotRefs = {}; state.view.countries = [];
    enableControls(false);
    ["selectedCountries", "metricSelect", "countryOptions", "trendLegend", "trendTableMount", "rankingTableMount", "scatterTableMount", "missingnessMount", "compareTableMount", "sourceList", "readinessList", "qualityList", "sourceRecords", "chapterList", "answerMount", "focusOverview", "macroLensGrid"].forEach((id) => clear($("#" + id)));
    ["economyCount", "indicatorCount", "observationWindow", "snapshotId", "retrievedAt", "providerUpdated", "sourceName"].forEach((id) => { $("#" + id).textContent = "Not loaded"; });
    for (const [id, text] of [["snapshotMode", "Unavailable"], ["coverageSummary", "Data not loaded"], ["gapHeadline", "Gaps are part of the record"], ["gapCopy", "Open research data to inspect annual coverage."], ["metricDescription", "Indicator definition and units will appear here."], ["indexNote", "Index mode requires a positive observation for every focus economy in a shared year."], ["timelineSubtitle", "Choose an indicator and observation window."], ["timelineStatus", "Data not loaded."], ["scatterStatus", "Data not loaded."], ["chapterSummary", ""]]) $("#" + id).textContent = publicText(text);
    emptyChart($("#compareChartMount"), "Choose economies to compare.", "comparison");
    emptyChart($("#trendMount"), "Research data is not available. Refresh the page to try again.", "timeline");
    emptyChart($("#rankingMount"), "No data for selected year.", "ranking"); emptyChart($("#scatterMount"), "No data for selected year.", "scatter");
  }
  async function load(snapshotId = null) {
    if (state.busy) return false;
    state.busy = true; setService(snapshotId ? "Opening saved data version" : "Opening research data", "loading"); setMessage(""); clearSnapshot();
    try {
      if (!window.EMIData || typeof window.EMIData.load !== "function") throw new Error("Private data access is unavailable. Reload the page to try again.");
      const data = await window.EMIData.load(snapshotId);
      validateSnapshot(data, snapshotId);
      init(); draw(); setService("Research data ready", "ready"); return true;
    } catch (error) {
      clearSnapshot(); setService("Data unavailable", "error");
      const context = snapshotId ? "This saved data version is unavailable. Your view has not been changed to another release." : "Research data could not be opened.";
      setMessage(`${context} Refresh the page to try again.`, true); return false;
    } finally { state.busy = false; refreshViews(); }
  }
  function init(saved = null) {
    const data = state.data, min = state.years[0], max = state.years.at(-1), defaults = DEFAULTS.filter((id) => data.countries.some((item) => item.id === id));
    const clamp = (value, fallback, low = min, high = max) => Number.isInteger(value) ? Math.max(low, Math.min(high, value)) : fallback;
    const from = clamp(saved?.from, min), to = Math.max(from, clamp(saved?.to, max));
    state.view = {
      metric: data.metrics.some((item) => item.id === saved?.metric) ? saved.metric : (data.metrics.find((item) => item.id === "BX.KLT.DINV.CD.WD") || data.metrics[0])?.id || "",
      from, to, year: clamp(saved?.year, to, from, to),
      countries: (Array.isArray(saved?.countries) ? saved.countries.filter((id) => data.countries.some((item) => item.id === id)) : defaults).slice(0, 3),
      mode: saved?.mode === "index" ? "index" : "level", baseYear: Number.isInteger(saved?.baseYear) ? saved.baseYear : null,
      scope: saved?.scope === "all" ? "all" : "top12", presentation: saved?.presentation === "table" ? "table" : "chart",
      tab: ["overview", "compare", "sources", "chapters"].includes(saved?.tab) ? saved.tab : "overview"
    };
    const metrics = $("#metricSelect"); clear(metrics); data.metrics.forEach((item) => { const option = el("option", "", item.label || item.id); option.value = item.id; metrics.append(option); }); metrics.value = state.view.metric;
    const countries = $("#countryOptions"); clear(countries); data.countries.forEach((item) => { const option = el("option"); option.value = item.name || item.id; countries.append(option); });
    for (const id of ["startYear", "endYear", "selectedYear"]) { $("#" + id).min = String(min); $("#" + id).max = String(max); }
    $("#startYear").value = from; $("#endYear").value = to; $("#selectedYear").value = state.view.year; $("#rankingScope").value = state.view.scope;
    document.querySelectorAll('input[name="seriesMode"]').forEach((input) => { input.checked = input.value === state.view.mode; });
    enableControls(true); refreshViews();
  }
  function readControls() {
    const minimum = state.years[0], maximum = state.years.at(-1);
    const bound = (id, fallback, low = minimum, high = maximum) => Math.max(low, Math.min(high, Math.trunc(Number($("#" + id).value) || fallback)));
    const from = bound("startYear", minimum); let to = bound("endYear", maximum); if (to < from) to = from;
    const year = bound("selectedYear", to, from, to);
    $("#startYear").value = from; $("#endYear").value = to; $("#selectedYear").value = year;
    Object.assign(state.view, { metric: $("#metricSelect").value, from, to, year, scope: $("#rankingScope").value, mode: $('input[name="seriesMode"]:checked').value });
  }
  function commonBase() {
    const valid = (year) => state.view.countries.length > 0 && state.view.countries.every((id) => { const value = obs(id, state.view.metric, year); return value !== null && value > 0; });
    if (Number.isInteger(state.view.baseYear) && state.view.baseYear >= state.view.from && state.view.baseYear <= state.view.to && valid(state.view.baseYear)) return state.view.baseYear;
    return state.years.find((year) => year >= state.view.from && year <= state.view.to && valid(year)) ?? null;
  }
  function displayed(id, year, base = commonBase()) {
    const value = obs(id, state.view.metric, year); if (value === null) return null;
    if (state.view.mode !== "index") return value;
    const starting = obs(id, state.view.metric, base); return starting !== null && starting > 0 ? 100 * value / starting : null;
  }
  function draw() {
    if (!state.data) return;
    readControls(); renderHeader(); renderMetric(); renderFocus(); renderFocusOverview(); renderCoverage(); renderMacroLens(); renderTimeline(); renderRanking(); renderScatter(); renderMissingness(); renderCompare(); renderSources(); renderChapters(); renderTabs(); refreshViews();
    $("#exportCsv").disabled = !state.view.countries.length; $("#exportSvg").disabled = !state.plotRefs.timeline;
  }
  function renderHeader() {
    const data = state.data, windowData = data.window || {};
    $("#economyCount").textContent = data.countries.length; $("#indicatorCount").textContent = data.metrics.length;
    $("#observationWindow").textContent = `${windowData.start}–${windowData.end}`;
    $("#snapshotId").textContent = ""; $("#snapshotMode").textContent = $("#pinSnapshot").checked ? "Saved data version" : "Available data version";
    $("#retrievedAt").textContent = date(data.retrieved_at); $("#providerUpdated").textContent = date(data.provider_last_updated); $("#sourceName").textContent = /world.?bank/i.test(data.source || "") ? "World Bank" : publicText(data.source || "Not supplied");
  }
  function renderMetric() {
    const item = metric();
    $("#overviewTitle").textContent = item?.label || "Explore the data";
    $("#metricDescription").textContent = item ? `${item.description || "Definition not supplied."} ${item.unit ? `Unit: ${item.unit}.` : ""}` : "Choose an indicator.";
    const base = commonBase(), index = $('input[name="seriesMode"][value="index"]'); index.disabled = !base;
    if (!base && state.view.mode === "index") { state.view.mode = "level"; $('input[name="seriesMode"][value="level"]').checked = true; }
    $("#indexNote").textContent = base ? `Shared positive base year: ${base}. Every focus economy is rebased to 100.` : "Index mode needs a positive observation for every focus economy in one shared year.";
  }
  function renderMacroLens() {
    const root = $("#macroLensGrid"), metrics = state.data.metrics, countries = state.view.countries, years = yearsView();
    clear(root); $("#macroLensWindow").textContent = `${state.view.from}–${state.view.to} · focus year ${state.view.year}`;
    metrics.forEach((item) => {
      const card = el("article", `macro-card${item.id === state.view.metric ? " active" : ""}`), head = el("div", "macro-card-head"), title = el("h4"), unit = el("span", "macro-unit", item.unit || "Unit not supplied");
      const choose = el("button", "macro-select", item.label || "Indicator"); choose.type = "button"; choose.setAttribute("aria-label", `Explore ${item.label || "indicator"}`);
      choose.addEventListener("click", () => { $("#metricSelect").value = item.id; state.view.baseYear = null; draw(); $("#overviewTitle").scrollIntoView({ block: "start", behavior: "auto" }); });
      title.append(choose); head.append(title, unit); card.append(head);
      const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 360 76"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${item.label || item.id} annual source values, ${state.view.from} to ${state.view.to}`);
      const guide = document.createElementNS(NS, "path"); guide.setAttribute("d", "M5 60H355 M5 31H355"); guide.setAttribute("fill", "none"); guide.setAttribute("stroke", "#e3e8eb"); guide.setAttribute("stroke-width", "1"); svg.append(guide);
      const rows = countries.map((id, index) => ({ id, index, values: years.map((year) => obs(id, item.id, year)) }));
      const valid = rows.flatMap((row) => row.values.filter((value) => value !== null));
      const min = Math.min(...valid), max = Math.max(...valid), span = max - min || Math.max(Math.abs(max || 0) * 0.1, 1);
      rows.forEach((row) => {
        const pts = row.values.map((value, index) => value === null ? null : [5 + (years.length < 2 ? 175 : index * 350 / (years.length - 1)), 55 - (value - min) * 48 / span]);
        let segment = [];
        const flush = () => { if (!segment.length) return; const path = document.createElementNS(NS, "path"); path.setAttribute("d", segment.map((pt, i) => `${i ? "L" : "M"}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(" ")); path.setAttribute("fill", "none"); path.setAttribute("stroke", COLORS[row.index % COLORS.length]); path.setAttribute("stroke-width", "2.5"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path); segment = []; };
        pts.forEach((pt, index) => { if (!pt) { flush(); return; } segment.push(pt); if (years[index] === state.view.year) { const dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", pt[0]); dot.setAttribute("cy", pt[1]); dot.setAttribute("r", "3.6"); dot.setAttribute("fill", COLORS[row.index % COLORS.length]); const tip = document.createElementNS(NS, "title"); tip.textContent = `${name(row.id)} · ${years[index]}: ${displayNumber(row.values[index], item)}`; dot.append(tip); svg.append(dot); } }); flush();
      });
      if (!valid.length) card.append(svg, el("p", "macro-empty", `No observations in ${state.view.from}–${state.view.to}.`)); else card.append(svg);
      const current = el("div", "macro-current");
      countries.forEach((id, index) => { const value = obs(id, item.id, state.view.year), line = el("div", "macro-current-row"); line.style.setProperty("--series", COLORS[index % COLORS.length]); line.append(el("span", "", name(id)), el("strong", "", compactNumber(value, item))); line.lastChild.title = displayNumber(value, item); current.append(line); });
      if (!countries.length) current.append(el("p", "macro-empty", "Choose focus economies to compare current values."));
      card.append(current);
      if (item.source_url) { const cite = el("div", "macro-citation"); addLink(cite, item.source_url, "Source"); card.append(cite); }
      root.append(card);
    });
  }
  function renderFocus() {
    const root = $("#selectedCountries"); clear(root);
    state.view.countries.forEach((id, index) => {
      const li = el("li", "focus-item"), swatch = el("i", "focus-swatch"), label = el("span", "", name(id)), remove = el("button", "remove-country", "Remove");
      swatch.style.setProperty("--series", COLORS[index]); remove.type = "button"; remove.setAttribute("aria-label", `Remove ${name(id)} from focus economies`);
      remove.addEventListener("click", () => { state.view.countries = state.view.countries.filter((value) => value !== id); state.view.baseYear = null; draw(); });
      li.append(swatch, label, remove); root.append(li);
    });
    if (!state.view.countries.length) root.append(el("li", "help", "Select up to three economies."));
    $("#focusCount").textContent = `${state.view.countries.length} / 3`;
    $("#countrySearch").disabled = $("#addCountry").disabled = state.view.countries.length >= 3;
  }
  function renderFocusOverview() {
    const root = $("#focusOverview"); clear(root);
    state.view.countries.forEach((id, index) => {
      const value = obs(id, state.view.metric, state.view.year), prior = state.view.year > state.view.from ? obs(id, state.view.metric, state.view.year - 1) : null;
      const card = el("article", "economy-summary"), header = el("div", "economy-summary-head"), dot = el("i", "focus-swatch"); dot.style.setProperty("--series", COLORS[index]); header.append(dot, el("span", "", name(id)));
      const number = value === null ? "No data" : compactNumber(value);
      const reading = el("strong", "economy-summary-value", number); reading.title = displayNumber(value);
      card.append(header, reading, el("span", "economy-summary-year", `${state.view.year} · ${itemUnit(metric())}`));
      const change = el("p", "economy-summary-change");
      if (value !== null && prior !== null) { const delta = value - prior; change.append(el("strong", "", `${delta > 0 ? "+" : ""}${compactNumber(delta, isPercent() ? { unit: "" } : metric())}${isPercent() ? " pp" : ""}`), document.createTextNode(` vs ${state.view.year - 1}`)); }
      else change.textContent = "Annual change unavailable";
      card.append(change); root.append(card);
    }); root.hidden = !state.view.countries.length;
  }
  function renderCoverage() {
    const years = yearsView(), ids = state.view.countries, expected = years.length * ids.length;
    let observed = 0; ids.forEach((id) => years.forEach((year) => { if (obs(id, state.view.metric, year) !== null) observed += 1; }));
    $("#coverageSummary").textContent = expected ? `${observed.toLocaleString("en")} of ${expected.toLocaleString("en")} selected observations · ${Math.round(100 * observed / expected)}% reported` : "Select focus economies to summarize coverage";
    $("#gapHeadline").textContent = expected ? `${(expected - observed).toLocaleString("en")} gaps in this view` : "Gaps are part of the record";
    $("#gapCopy").textContent = expected ? `${observed.toLocaleString("en")} values across ${ids.length} economies and ${years.length} years. Missing values remain blank.` : "Add economies to map their reporting years.";
    const marks = $("#coverageMarks"); clear(marks);
    years.slice(-16).forEach((year) => { const mark = el("i", "coverage-tick"); const complete = ids.length > 0 && ids.every((id) => obs(id, state.view.metric, year) !== null); mark.classList.toggle("gap", !complete); mark.title = `${year}: ${complete ? "all focus economies reported" : "one or more observations missing"}`; marks.append(mark); });
  }
  function plotConfig() { return { responsive: true, displaylogo: false, scrollZoom: false, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] }; }
  function plotLayout(extra = {}) {
    return { paper_bgcolor: PLOT.paper, plot_bgcolor: PLOT.paper, font: { family: "IBM Plex Sans, Arial, sans-serif", size: 13, color: PLOT.ink }, hoverlabel: { bgcolor: PLOT.navy, bordercolor: PLOT.navy, font: { family: "IBM Plex Sans, Arial, sans-serif", color: "#fff", size: 14 } }, margin: { l: 68, r: 22, t: 14, b: 58 }, showlegend: false, ...extra };
  }
  function fitVisiblePlot(root) {
    if (root?.data && root.clientWidth && root.clientHeight && window.Plotly) {
      // A chart first drawn in a hidden tab has Plotly's fallback width.
      // Explicitly use the measured mount width once the panel is visible.
      window.Plotly.relayout(root, { width: root.clientWidth, autosize: true });
    }
  }
  function renderPlot(root, key, traces, layout, onPoint) {
    const plotly = window.Plotly;
    state.plotRefs[key] = null; if (key === "timeline") $("#exportSvg").disabled = true;
    if (!plotly) { emptyChart(root, "Interactive charts are not available. Use the table view or reload the published page.", key); return; }
    const token = (state.renders.get(root) || 0) + 1; state.renders.set(root, token);
    root.style.height = `${layout.height}px`; // Reserve chart flow before responsive SVG layout settles.
    if (!root.data) clear(root); // Remove the earlier loading/empty state before Plotly owns this mount.
    const previous = root.data ? plotly.react(root, traces, layout, plotConfig()) : plotly.newPlot(root, traces, layout, plotConfig());
    Promise.resolve(previous).then(() => {
      if (state.renders.get(root) !== token) return;
      state.plotRefs[key] = root; fitVisiblePlot(root);
      if (key === "timeline") $("#exportSvg").disabled = !state.view.countries.length;
      root.removeAllListeners?.("plotly_click"); if (onPoint) root.on("plotly_click", onPoint);
    }).catch(() => { if (state.renders.get(root) === token) emptyChart(root, "The chart could not be drawn. The accessible data table remains available.", key); });
  }
  function renderTimelineTable(years) {
    const table = el("table", "data-table"), head = el("thead"), header = el("tr"), body = el("tbody"), base = commonBase();
    header.append(el("th", "", "Year")); state.view.countries.forEach((id) => header.append(el("th", "", name(id)))); head.append(header);
    years.forEach((year) => { const row = el("tr", year === state.view.year ? "selected" : ""); row.append(el("th", "", year)); state.view.countries.forEach((id) => { const value = displayed(id, year, base); row.append(el("td", value === null ? "missing" : "", value === null ? "No observation" : displayNumber(value, state.view.mode === "index" ? { unit: "index points" } : metric()))); }); body.append(row); });
    table.append(head, body); $("#trendTableMount").replaceChildren(table);
  }
  function renderTimeline() {
    const root = $("#trendMount"), years = yearsView(), ids = state.view.countries, item = metric(), base = commonBase();
    const hasValues = ids.some((id) => years.some((year) => displayed(id, year, base) !== null));
    $("#timelineSubtitle").textContent = `${item?.label || "Indicator"} · ${state.view.from}–${state.view.to} · ${displayUnit()}${state.view.mode === "index" ? ` · base year ${base}` : ""}`;
    const selectedReported = ids.some((id) => obs(id, state.view.metric, state.view.year) !== null);
    $("#timelineStatus").textContent = selectedReported ? "Hover for source and displayed values. The line breaks at every missing annual observation." : `No data for selected year (${state.view.year}) for the selected focus economies.`;
    const legend = $("#trendLegend"); clear(legend);
    ids.forEach((id, index) => { const tag = el("span", "legend-item"), swatch = el("i", "focus-swatch"); swatch.style.setProperty("--series", COLORS[index]); tag.append(swatch, el("span", "", name(id))); legend.append(tag); });
    if (!ids.length || !years.length || !hasValues) { emptyChart(root, !ids.length ? "Select a focus economy to draw the timeline." : `No data for the selected indicator from ${state.view.from} to ${state.view.to}.`, "timeline"); renderTimelineTable(years); toggleTimeline(); return; }
    const traces = ids.map((id, index) => ({
      type: "scatter", mode: "lines+markers", name: esc(name(id)), x: years,
      y: years.map((year) => displayed(id, year, base)), connectgaps: false,
      line: { color: COLORS[index], width: 2.6 }, marker: { color: COLORS[index], size: 4, line: { color: "#fff", width: 0.7 } },
      customdata: years.map((year) => [obs(id, state.view.metric, year), year]),
      hovertemplate: `<b>${esc(name(id))}</b><br>%{x}: %{y:,.4g}<br>Source value: %{customdata[0]:,.4g} ${esc(item?.unit || "")}<extra></extra>`
    }));
    const layout = plotLayout({ height: window.innerWidth < 560 ? 300 : 365, showlegend: false, legend: { orientation: "h", x: 0, y: 1.13, font: { size: 13 } }, margin: { l: window.innerWidth < 560 ? 48 : 58, r: 18, t: 20, b: 38 }, hovermode: "x unified", dragmode: "zoom",
      xaxis: { title: { text: "" }, tickfont: { size: 12 }, range: [state.view.from, state.view.to], dtick: Math.max(1, Math.ceil((state.view.to - state.view.from) / (window.innerWidth < 560 ? 4 : 6))), tick0: state.view.from, showgrid: false, zeroline: false, fixedrange: false },
      yaxis: { title: { text: "" }, tickfont: { size: 12 }, gridcolor: PLOT.grid, zeroline: true, zerolinecolor: "#adbcb3", zerolinewidth: 1, automargin: true, ...chartTicks(traces.flatMap((trace) => trace.y), state.view.mode === "index" ? { unit: "index" } : item) },
      shapes: [{ type: "line", x0: state.view.year, x1: state.view.year, y0: 0, y1: 1, yref: "paper", line: { color: "#93a0ac", width: 1, dash: "dot" } }]
    });
    renderPlot(root, "timeline", traces, layout); renderTimelineTable(years); toggleTimeline();
  }
  function toggleTimeline() {
    const chart = state.view.presentation === "chart"; $("#trendMount").hidden = !chart; $("#trendTableMount").hidden = chart;
    for (const [id, active] of [["showChart", chart], ["showTable", !chart]]) { $("#" + id).classList.toggle("selected", active); $("#" + id).setAttribute("aria-pressed", String(active)); }
  }
  function renderRanking() {
    const root = $("#rankingMount"); $("#rankYear").textContent = state.view.year;
    const rows = state.data.countries.map((item) => ({ item, value: obs(item.id, state.view.metric, state.view.year) })).filter((row) => row.value !== null).sort((a, b) => b.value - a.value);
    if (!rows.length) { emptyChart(root, `No data for selected year (${state.view.year}).`, "ranking"); clear($("#rankingTableMount")); return; }
    const focus = new Set(state.view.countries), shown = state.view.scope === "all" ? rows : rows.filter((row, index) => index < 12 || focus.has(row.item.id));
    const categories = shown.map((row) => row.item.name || row.item.id), values = shown.map((row) => row.value), maximum = Math.max(1, ...values.map(Math.abs));
    const trace = { type: "bar", orientation: "h", y: categories, x: values, marker: { color: shown.map((row) => focus.has(row.item.id) ? COLORS[state.view.countries.indexOf(row.item.id)] : "#a4b6b0"), line: { color: "#fff", width: 0.5 } }, customdata: shown.map((row) => [esc(row.item.id), displayNumber(row.value)]), hovertemplate: `<b>%{y}</b><br>${state.view.year}: %{customdata[1]}<extra></extra>` };
    const height = Math.max(430, Math.min(6200, shown.length * 27 + 100));
    const layout = plotLayout({ height, bargap: 0.26, margin: { l: Math.min(220, Math.max(150, Math.round(window.innerWidth * 0.32))), r: 30, t: 14, b: 76 }, xaxis: { title: { text: itemUnit(metric()), font: { size: 14 } }, tickfont: { size: 13 }, range: [Math.min(0, ...values) * 1.1, Math.max(1, ...values) * 1.12], zeroline: true, zerolinecolor: "#687784", zerolinewidth: 1.6, gridcolor: PLOT.grid, ...chartTicks(values), automargin: true }, yaxis: { autorange: "reversed", tickfont: { size: 13 }, automargin: true, fixedrange: true } });
    renderPlot(root, "ranking", [trace], layout);
    $("#rankingTableMount").replaceChildren(makeTable(["Rank", "Economy", `Value · ${itemUnit(metric())}`], shown.map((row) => [rows.indexOf(row) + 1, row.item.name || row.item.id, displayNumber(row.value)])));
  }
  function itemUnit(item) { return item?.unit || "Source unit not supplied"; }
  function renderScatter() {
    const root = $("#scatterMount"); $("#scatterYear").textContent = state.view.year;
    const points = state.data.countries.map((item) => ({ item, x: obs(item.id, "NY.GDP.PCAP.CD", state.view.year), y: obs(item.id, "BX.KLT.DINV.CD.WD", state.view.year) })).filter((point) => point.x !== null && point.x > 0 && point.y !== null);
    if (!points.length) { emptyChart(root, `No data for selected year (${state.view.year}) with both GDP per capita and inward FDI.`, "scatter"); $("#scatterStatus").textContent = "A point requires positive GDP per capita and a reported net inward FDI value."; clear($("#scatterTableMount")); return; }
    const selected = new Set(state.view.countries);
    const trace = { type: "scatter", mode: "markers", x: points.map((point) => point.x), y: points.map((point) => point.y),
      marker: { size: points.map((point) => selected.has(point.item.id) ? 12 : 6), color: points.map((point) => selected.has(point.item.id) ? COLORS[state.view.countries.indexOf(point.item.id)] : "#839d96"), opacity: 0.78, line: { color: "#fff", width: 1 } },
      customdata: points.map((point) => [esc(point.item.id), esc(point.item.name || point.item.id), point.x, point.y]),
      hovertemplate: `<b>%{customdata[1]}</b><br>GDP per capita: $%{customdata[2]:,.0f} (current US$)<br>Net inward FDI: $%{customdata[3]:,.4g} (current US$)<br>Year: ${state.view.year}<extra></extra>` };
    const zero = Math.min(...points.map((point) => point.y)) < 0 && Math.max(...points.map((point) => point.y)) > 0;
    const layout = plotLayout({ height: 430, margin: { l: window.innerWidth < 560 ? 67 : 85, r: 16, t: 18, b: 77 }, hovermode: "closest", xaxis: { type: "log", title: { text: "GDP per capita · US$ · logarithmic scale", font: { size: 14 } }, tickfont: { size: 13 }, gridcolor: PLOT.grid, zeroline: false, tickprefix: "$", tickformat: "~s", automargin: true }, yaxis: { title: { text: "Net inward FDI · US$", font: { size: 14 } }, tickfont: { size: 13 }, gridcolor: PLOT.grid, zeroline: true, zerolinecolor: "#687784", zerolinewidth: 1.6, ...chartTicks(points.map((point) => point.y), { unit: "current US$" }), automargin: true } });
    renderPlot(root, "scatter", [trace], layout, (event) => { const id = event.points?.[0]?.customdata?.[0]; if (typeof id === "string") addCountry(id, true); });
    $("#scatterTableMount").replaceChildren(makeTable(["Economy", "GDP per capita · current U.S. dollars", "Net inward FDI · US$"], points.map((point) => [point.item.name || point.item.id, displayNumber(point.x, { unit: "current US$" }), displayNumber(point.y, { unit: "current US$" })])));
    $("#scatterStatus").textContent = `${points.length} economies with both values. Negative inward flows remain visible. Select a point to add it to focus.`;
  }
  function makeTable(headers, rows, cls = "data-table") {
    const table = el("table", cls), head = el("thead"), hr = el("tr"), body = el("tbody");
    headers.forEach((header) => hr.append(el("th", "", header))); head.append(hr);
    rows.forEach((cells) => { const tr = el("tr", cells[0] === state.view.year ? "selected" : ""); cells.forEach((value, index) => tr.append(el(index === 0 ? "th" : "td", value === null ? "missing" : "", value === null ? "No observation" : value))); body.append(tr); });
    table.append(head, body); return table;
  }
  function renderMissingness() {
    const root = $("#missingnessMount"), ids = state.view.countries, years = yearsView(); clear(root);
    if (!ids.length) { root.append(el("p", "empty-state", "Choose an economy to inspect its reporting coverage.")); return; }
    const table = el("table", "data-table coverage-table"), head = el("thead"), hr = el("tr"), body = el("tbody");
    hr.append(el("th", "", "Economy")); years.forEach((year) => hr.append(el("th", "", year))); head.append(hr);
    ids.forEach((id) => {
      const row = el("tr"); row.append(el("th", "", name(id)));
      years.forEach((year) => { const value = obs(id, state.view.metric, year), td = el("td", year === state.view.year ? "selected-year" : ""), mark = el("span", `coverage-cell${value === null ? " missing-cell" : ""}`), label = `${name(id)}, ${year}: ${value === null ? "No observation" : displayNumber(value)}`; mark.title = label; mark.append(el("span", "sr", label)); td.append(mark); row.append(td); });
      body.append(row);
    }); table.append(head, body); root.append(table);
  }
  function renderCompare() {
    renderCompareChart();
    const root = $("#compareTableMount"), ids = state.view.countries, base = commonBase(); clear(root);
    const years = yearsView(), commonYears = years.filter((year) => ids.length > 0 && ids.every((id) => obs(id, state.view.metric, year) !== null));
    $("#compareNote").textContent = `${ids.length} economies · ${commonYears.length} common years · ${state.view.from}–${state.view.to} · ${state.view.mode === "index" ? `index base ${base ?? "unavailable"}` : itemUnit(metric())}`;
    if (!ids.length) { root.append(el("p", "empty-state", "Choose up to three focus economies to compare.")); return; }
    root.append(makeTable(["Year", ...ids.map((id) => name(id))], years.map((year) => [year, ...ids.map((id) => { const value = displayed(id, year, base); return value === null ? null : displayNumber(value, state.view.mode === "index" ? { unit: "index points" } : metric()); })])));
  }
  function renderCompareChart() {
    const root = $("#compareChartMount"), ids = state.view.countries, first = state.view.from, last = state.view.to, base = commonBase();
    $("#compareChartNote").textContent = `${metric()?.label || "Selected indicator"} · ${first} and ${last} · ${displayUnit()}. A missing endpoint is left blank.`;
    if (!ids.length || !ids.some((id) => displayed(id, first, base) !== null || displayed(id, last, base) !== null)) { emptyChart(root, "No endpoint observations for this selection.", "comparison"); return; }
    const traces = ids.map((id, index) => ({ type: "scatter", mode: "lines+markers", x: [displayed(id, first, base), displayed(id, last, base)], y: [name(id), name(id)], connectgaps: false, line: { color: "#c3ccd0", width: 3 }, marker: { color: [COLORS[index], COLORS[index]], size: 12, symbol: ["circle-open", "circle"] }, customdata: [first, last], hovertemplate: `<b>${esc(name(id))}</b><br>%{customdata}: %{x:,.4g} ${esc(displayUnit())}<extra></extra>`, showlegend: false }));
    const layout = plotLayout({ height: Math.max(230, ids.length * 65 + 90), margin: { l: window.innerWidth < 560 ? 78 : 120, r: 35, t: 20, b: 70 }, xaxis: { title: { text: state.view.mode === "index" ? "Index, common base = 100" : itemUnit(metric()), font: { size: 12 } }, gridcolor: PLOT.grid, zeroline: true, zerolinecolor: "#82939e", tickformat: "~s", automargin: true }, yaxis: { autorange: "reversed", tickfont: { size: 13 }, automargin: true, fixedrange: true }, annotations: [{ x: 0, y: 1.12, xref: "paper", yref: "paper", xanchor: "left", text: `Open circle: ${first} · Filled circle: ${last}`, showarrow: false, font: { size: 11, color: PLOT.muted } }] });
    renderPlot(root, "comparison", traces, layout);
  }
  function record(parent, title, description, tag) {
    const article = el("article", "record"), top = el("div", "record-head"); top.append(el("strong", "", title), el("span", "record-tag", tag || "Recorded")); article.append(top); if (description) article.append(el("p", "record-note", publicText(description))); parent.append(article); return article;
  }
  function renderSources() {
    const sourceRoot = $("#sourceList"); clear(sourceRoot);
    state.data.metrics.forEach((item) => { const article = record(sourceRoot, item.label || "Indicator", `${item.description || "Definition not supplied."} ${item.unit ? `Unit: ${item.unit}.` : ""} ${item.frequency ? `Frequency: ${item.frequency}.` : ""}`, item.frequency || "Annual"); if (item.source_url) { const p = el("p", "record-note"); addLink(p, item.source_url, "Open source series"); article.append(p); } });
    const readinessRoot = $("#readinessList"); clear(readinessRoot);
    (state.data.readiness || []).forEach((item) => { const article = record(readinessRoot, item.provider || item.route || "Provider", item.notes || item.route || "No readiness note supplied.", ({ connected_validated_snapshot: "Validated data copy", snapshot_validated: "Validated data copy", acquisition_pending: "Acquisition pending", license_required: "Permission required", pending_license: "Permission required", manual_review: "Review required" }[item.status] || "See coverage note")); if (item.doc_url) { const p = el("p", "record-note"); addLink(p, item.doc_url, "Provider documentation"); article.append(p); } });
    if (!(state.data.readiness || []).length) readinessRoot.append(el("p", "empty-state", "Provider coverage notes are not included in this release."));
    const qualityRoot = $("#qualityList"); clear(qualityRoot);
    Object.entries(state.data.quality || {}).filter(([key, value]) => typeof value === "number" || typeof value === "boolean").forEach(([key, value]) => { const box = el("div", "quality-item"); box.append(el("span", "quality-label", key.replaceAll("_", " ")), el("strong", "", typeof value === "boolean" ? value ? "Yes" : "No" : fmt(value, 0))); qualityRoot.append(box); });
    if (!qualityRoot.childNodes.length) qualityRoot.append(el("p", "empty-state", "No quality summary supplied."));
    const recordsRoot = $("#sourceRecords"); clear(recordsRoot);
    (state.data.sources || []).forEach((item, index) => { const row = el("article", "source-record"); addLink(row, item.url, `Source publication ${index + 1}`); row.append(el("p", "record-note", [item.records !== undefined && `${item.records.toLocaleString("en")} observations`, item.lastupdated && `Source updated ${date(item.lastupdated)}`, item.retrieved_at && `Retrieved ${date(item.retrieved_at)}`].filter(Boolean).join(" · "))); recordsRoot.append(row); });
    const geo = state.data.quality?.geography_classification;
    if (geo) { const note = el("p", "geography-note", `Country names and classifications use metadata captured ${date(geo.vintage)}. Historical classification membership is not inferred.`); recordsRoot.prepend(note); }
  }
  function renderChapters() {
    const root = $("#chapterList"), items = state.data.chapters || []; clear(root);
    $("#chapterSummary").textContent = `${items.length} chapter records`;
    items.forEach((item) => { const article = el("article", "chapter-item"), header = el("div", "chapter-head"); header.append(el("span", "chapter-id", `CHAPTER ${item.id}`), el("span", "record-tag", publicText((item.status || "Status not supplied").replaceAll("_", " ")))); article.append(header, el("h3", "", item.title || "Untitled chapter"), el("p", "record-note", item.notes || "No scope note supplied.")); root.append(article); });
    if (!items.length) root.append(el("p", "empty-state", "Research agenda notes are not included in this release."));
  }
  function renderTabs() {
    document.querySelectorAll(".tab").forEach((button) => { const active = button.dataset.tab === state.view.tab; button.classList.toggle("active", active); active ? button.setAttribute("aria-current", "page") : button.removeAttribute("aria-current"); });
    document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${state.view.tab}`; });
    requestAnimationFrame(() => Object.values(state.plotRefs).forEach(fitVisiblePlot));
  }
  function addCountry(id, fromPoint = false) {
    if (state.view.countries.includes(id)) { $("#scatterStatus").textContent = `${name(id)} is already in focus.`; return; }
    if (state.view.countries.length >= 3) { const text = "Remove a focus economy before adding another."; fromPoint ? $("#scatterStatus").textContent = text : setMessage(text, true); return; }
    state.view.countries.push(id); state.view.baseYear = null; if (!fromPoint) $("#countrySearch").value = ""; draw(); $("#scatterStatus").textContent = `${name(id)} added to focus economies.`;
  }
  function findCountry(query) {
    const value = query.trim().toLowerCase(); if (!value) return null;
    return state.data.countries.find((item) => item.id.toLowerCase() === value) || state.data.countries.find((item) => (item.name || "").toLowerCase() === value) || state.data.countries.find((item) => item.id.toLowerCase().includes(value) || (item.name || "").toLowerCase().includes(value)) || null;
  }
  function allViews() {
    const result = [];
    try { for (let i = 0; i < localStorage.length; i += 1) { const key = localStorage.key(i); if (!key?.startsWith(STORE)) continue; const parsed = JSON.parse(localStorage.getItem(key) || "[]"); if (Array.isArray(parsed)) result.push(...parsed.filter((item) => item && typeof item.name === "string" && typeof item.snapshot_id === "string" && item.settings)); } }
    catch (_) { /* A malformed local entry does not block the Observatory. */ }
    return result.sort((a, b) => (b.saved_at || "").localeCompare(a.saved_at || ""));
  }
  function refreshViews() {
    const select = $("#savedViews"), previous = select.value; clear(select);
    const placeholder = el("option", "", "Choose a saved view"); placeholder.value = ""; select.append(placeholder);
    allViews().forEach((item) => { const option = el("option", "", `${item.name} · ${item.pinned ? "saved data version" : "latest data"}`); option.value = item.key; select.append(option); });
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    $("#loadView").disabled = !select.value || state.busy; $("#deleteView").disabled = !select.value;
  }
  function currentSettings() { return { ...state.view, countries: [...state.view.countries], baseYear: commonBase() }; }
  function saveView() {
    const viewName = $("#viewName").value.trim(); if (!viewName) { setMessage("Enter a name for this view.", true); $("#viewName").focus(); return; }
    const snapshotId = state.data.snapshot_id, key = `${snapshotId}:${Date.now().toString(36)}`, item = { key, name: viewName, snapshot_id: snapshotId, pinned: $("#pinSnapshot").checked, settings: currentSettings(), saved_at: new Date().toISOString() }, storageKey = STORE + encodeURIComponent(snapshotId);
    try { const list = JSON.parse(localStorage.getItem(storageKey) || "[]"); localStorage.setItem(storageKey, JSON.stringify([...list.filter((saved) => saved.name !== viewName), item])); $("#viewName").value = ""; refreshViews(); $("#savedViews").value = key; refreshViews(); setMessage(`${viewName} saved as ${item.pinned ? "a view with this data version" : "a view using the latest data"}.`); }
    catch (_) { setMessage("The browser could not save this view. Check local storage settings.", true); }
  }
  async function openView() {
    const saved = allViews().find((item) => item.key === $("#savedViews").value); if (!saved) return;
    if (saved.pinned) {
      if (!state.data || saved.snapshot_id !== state.data.snapshot_id) await load(saved.snapshot_id);
      if (state.data?.snapshot_id !== saved.snapshot_id) return;
    } else { if (!await load()) return; }
    init(saved.settings); $("#pinSnapshot").checked = Boolean(saved.pinned); draw(); setMessage(`${saved.pinned ? "Saved data version" : "Latest data"}: ${saved.name}.`);
  }
  function deleteView() {
    const saved = allViews().find((item) => item.key === $("#savedViews").value); if (!saved) return;
    const storageKey = STORE + encodeURIComponent(saved.snapshot_id);
    try { const left = JSON.parse(localStorage.getItem(storageKey) || "[]").filter((item) => item.key !== saved.key); left.length ? localStorage.setItem(storageKey, JSON.stringify(left)) : localStorage.removeItem(storageKey); refreshViews(); setMessage(`Saved view deleted: ${saved.name}.`); }
    catch (_) { setMessage("The browser could not update saved views.", true); }
  }
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^\s*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), anchor = el("a"); anchor.href = url; anchor.download = filename; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCsv() {
    const item = metric(), base = commonBase(), transformation = state.view.mode === "index" ? "Indexed to 100 at common positive base year" : "Untransformed source value", unit = state.view.mode === "index" ? "index points" : item?.unit || "";
    const rows = [["snapshot_id", state.data.snapshot_id], ["retrieved_at_utc", state.data.retrieved_at || ""], ["provider_last_updated", state.data.provider_last_updated || ""], ["source", state.data.source || ""], ["metric_id", item?.id || ""], ["metric_label", item?.label || ""], ["metric_unit", item?.unit || ""], ["window", `${state.view.from}-${state.view.to}`], ["focus_economies", state.view.countries.join(" ")], ["transformation", transformation], ["base_year", state.view.mode === "index" ? base : ""], [], ["row_type", "country_id", "country_name", "metric_id", "year", "original_value", "original_unit", "displayed_value", "display_unit", "transformation", "base_year", "snapshot_id"]];
    for (const id of state.view.countries) for (const year of yearsView()) { const original = obs(id, state.view.metric, year), value = displayed(id, year, base); rows.push(["filtered", id, name(id), state.view.metric, year, original, item?.unit || "", value, unit, transformation, state.view.mode === "index" ? base : "", state.data.snapshot_id]); }
    rows.push([], ["row_type", "country_id", "country_name", "metric_id", "year", "original_value", "original_unit", "displayed_value", "display_unit", "transformation", "base_year", "snapshot_id"]);
    for (const id of state.view.countries) { const year = [...state.years].reverse().find((value) => obs(id, state.view.metric, value) !== null); if (year !== undefined) { const original = obs(id, state.view.metric, year), value = displayed(id, year, base); rows.push(["latest_per_country", id, name(id), state.view.metric, year, original, item?.unit || "", value, unit, transformation, state.view.mode === "index" ? base : "", state.data.snapshot_id]); } }
    download(new Blob(["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), `emi-${item?.id || "indicator"}-${state.view.from}-${state.view.to}.csv`);
  }
  function xmlDataUrl(dataUrl) {
    const comma = dataUrl.indexOf(","), header = dataUrl.slice(0, comma), payload = dataUrl.slice(comma + 1);
    return header.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  }
  async function exportSvg() {
    const plot = state.plotRefs.timeline; if (!plot || !window.Plotly?.toImage) return;
    try {
      const image = await window.Plotly.toImage(plot, { format: "svg", width: Math.max(1000, plot.clientWidth), height: 500 });
      const documentSvg = new DOMParser().parseFromString(xmlDataUrl(image), "image/svg+xml"), root = documentSvg.documentElement;
      if (documentSvg.querySelector("parsererror")) throw new Error("The chart did not produce a valid SVG.");
      const item = metric(), source = safeUrl(item?.source_url || state.data.sources?.[0]?.url), provider = source ? new URL(source).hostname : "citation not supplied", base = commonBase(), metadata = documentSvg.createElementNS(NS, "metadata"), desc = documentSvg.createElementNS(NS, "desc");
      desc.textContent = `Source: ${item?.label || "Indicator"} (${item?.id || state.view.metric}), ${provider}, ${item?.source_url || state.data.sources?.[0]?.url || "source URL not supplied"}. Original unit: ${item?.unit || "not supplied"}. Display unit: ${displayUnit()}. Transformation: ${state.view.mode === "index" ? `Index to 100 at base year ${base}` : "Untransformed source value"}. Snapshot: ${state.data.snapshot_id}. Retrieved: ${state.data.retrieved_at || "not supplied"}. Provider vintage: ${state.data.provider_last_updated || "not supplied"}.`;
      metadata.append(desc); root.insertBefore(metadata, root.firstChild);
      const viewBox = (root.getAttribute("viewBox") || `0 0 ${plot.clientWidth || 1000} 500`).split(/[ ,]+/).map(Number), width = viewBox[2] || 1000, height = viewBox[3] || 500, extra = 62;
      root.setAttribute("viewBox", `${viewBox[0] || 0} ${viewBox[1] || 0} ${width} ${height + extra}`); root.setAttribute("height", String(height + extra));
      const footer = documentSvg.createElementNS(NS, "g"), sourceLine = documentSvg.createElementNS(NS, "text"), transformLine = documentSvg.createElementNS(NS, "text"), snapshotLine = documentSvg.createElementNS(NS, "text");
      footer.setAttribute("font-family", "Arial, sans-serif"); footer.setAttribute("font-size", "11"); footer.setAttribute("fill", "#465b70");
      [[sourceLine, `Source: ${item?.label || "Indicator"} · ${item?.id || state.view.metric} · ${provider}`], [transformLine, `Original unit: ${item?.unit || "not supplied"} · Display unit: ${displayUnit()} · ${state.view.mode === "index" ? `Index base ${base ?? "unavailable"} = 100` : "Source level"}`], [snapshotLine, `Snapshot: ${state.data.snapshot_id} · Retrieved: ${date(state.data.retrieved_at)} · Provider vintage: ${date(state.data.provider_last_updated)}`]].forEach(([node, text], index) => { node.setAttribute("x", "76"); node.setAttribute("y", String(height + 17 + index * 14)); node.textContent = text; footer.append(node); });
      root.append(footer);
      download(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml;charset=utf-8" }), `emi-timeline-${state.view.from}-${state.view.to}.svg`);
    } catch (error) { setMessage(`SVG export failed. ${error.message || "Try again."}`, true); }
  }
  function appendAnswerProvenance(parent, response, requestedCountries, payload) {
    const sources = Array.isArray(response.sources) ? response.sources : response.source ? [response.source] : [];
    sources.forEach((source) => { const p = el("p", "answer-source"); if (typeof source === "string") addLink(p, source, "View source"); else if (source && typeof source === "object") addLink(p, source.url, publicText(source.title || source.label || "View source")); parent.append(p); });
    const resolved = response.resolved_filters && typeof response.resolved_filters === "object" ? response.resolved_filters : {};
    const countries = Array.isArray(resolved.countries) ? resolved.countries : Array.isArray(response.countries) ? response.countries : requestedCountries;
    const selectedMetric = state.data.metrics.find((item) => item.id === (resolved.metric || response.metric || payload.metric));
    parent.append(el("p", "answer-meta", `${selectedMetric?.label || "Selected indicator"} · ${resolved.year ?? response.year ?? payload.year} · ${countries.map(name).join(", ") || "All reporting economies"} · Source updated ${date(state.data.provider_last_updated)}`));
  }
  async function ask(e) {
    e.preventDefault(); const question = $("#questionInput").value.trim(); if (!question) return $("#questionInput").focus();
    const output = $("#answerMount"); output.replaceChildren(el("p", "help", "Checking the selected data…")); $("#askButton").disabled = true;
    const asksRanking = /\b(rank(?:ing)?|top|largest|smallest|highest|lowest)\b/i.test(question), countries = asksRanking && state.view.scope === "all" ? [] : [...state.view.countries];
    const payload = { question, metric: state.view.metric, countries, year: state.view.year, start_year: state.view.from, end_year: state.view.to, snapshot_id: state.data.snapshot_id };
    try {
      if (!window.EMIQuestions || typeof window.EMIQuestions.answer !== "function") throw new Error("The browser question module is unavailable in this site build.");
      const response = await window.EMIQuestions.answer(state.data, payload);
      if (!state.data || state.data.snapshot_id !== payload.snapshot_id) throw new Error("The active snapshot changed while this question was being processed. Ask again.");
      if (!response || typeof response !== "object") throw new Error("The question module returned an invalid response.");
      if (response.snapshot_id && response.snapshot_id !== state.data.snapshot_id) throw new Error("The answer refers to another snapshot, so it was not displayed.");
      if (response.status === "error") throw new Error(typeof response.answer === "string" ? response.answer : "This question could not be answered from the selected snapshot.");
      const answer = typeof response.answer === "string" ? response.answer : typeof response.text === "string" ? response.text : "No answer text was returned.";
      const card = el("article", "answer-card"); card.append(el("span", "section-kicker", "Answer from the selected data"), el("p", "answer-text", publicText(answer))); appendAnswerProvenance(card, response, countries, payload); output.replaceChildren(card);
    } catch (error) { output.replaceChildren(el("p", "answer-error", publicText(error.message || "Could not answer from the selected data."))); }
    finally { $("#askButton").disabled = false; }
  }

  $("#reloadLatest").addEventListener("click", () => { $("#pinSnapshot").checked = false; const url = new URL(location.href); url.searchParams.delete("snapshot_id"); history.replaceState(null, "", url); load(); });
  $("#metricSelect").addEventListener("change", () => { state.view.baseYear = null; draw(); });
  ["#startYear", "#endYear"].forEach((selector) => $(selector).addEventListener("change", () => { state.view.baseYear = null; draw(); }));
  ["#selectedYear", "#rankingScope"].forEach((selector) => $(selector).addEventListener("change", draw));
  document.querySelectorAll('input[name="seriesMode"]').forEach((input) => input.addEventListener("change", () => { state.view.mode = input.value; draw(); }));
  $("#addCountry").addEventListener("click", () => { const found = findCountry($("#countrySearch").value); if (!found) return setMessage("Choose an economy listed in this snapshot.", true); addCountry(found.id); });
  $("#countrySearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); $("#addCountry").click(); } });
  $("#showChart").addEventListener("click", () => { state.view.presentation = "chart"; toggleTimeline(); });
  $("#showTable").addEventListener("click", () => { state.view.presentation = "table"; toggleTimeline(); });
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => { state.view.tab = button.dataset.tab; renderTabs(); }));
  $("#saveView").addEventListener("click", saveView); $("#savedViews").addEventListener("change", refreshViews); $("#loadView").addEventListener("click", openView); $("#deleteView").addEventListener("click", deleteView);
  $("#pinSnapshot").addEventListener("change", renderHeader); $("#exportCsv").addEventListener("click", exportCsv); $("#exportSvg").addEventListener("click", exportSvg); $("#questionForm").addEventListener("submit", ask);
  let resizeQueued = false, compactCharts = window.innerWidth < 560;
  window.addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      const compact = window.innerWidth < 560;
      if (state.data && compact !== compactCharts) {
        compactCharts = compact;
        renderTimeline(); renderRanking(); renderScatter(); renderCompareChart();
      } else Object.values(state.plotRefs).forEach(fitVisiblePlot);
    });
  }, { passive: true });
  $("#toggleFilters").addEventListener("click", () => { const expanded = $(".controls").classList.toggle("expanded"); $("#toggleFilters").setAttribute("aria-expanded", String(expanded)); $("#toggleFilters span").textContent = expanded ? "−" : "+"; });
  const directSnapshot = new URL(location.href).searchParams.get("snapshot_id");
  $("#pinSnapshot").checked = Boolean(directSnapshot);
  load(directSnapshot || null);
})();
