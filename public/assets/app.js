// Interface for the EP01 calculator. All calculation happens in engine.js;
// this file only collects input, renders the engine output and exports it.

import {
  evaluate,
  buildExportRecord,
  parseCurveCsv,
  ENGINE_VERSION,
  SPEC_VERSION,
  CALCULATOR_ID,
  PRESSURE_UNITS,
  CURVE_DATA_TYPES,
  MAX_CONFIGURATIONS,
  REQUIRED_CURVE_METADATA,
} from "./engine.js";
import { renderPlot, markerShape } from "./plot.js";

const STORAGE_KEY = "ep01-cushion-bearing-area:state:v1";
const IDS = ["A", "B", "C"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function emptyCurve() {
  return {
    datasetId: "",
    datasetVersion: "",
    dataType: "",
    material: "",
    thickness: { value: "", unit: "mm" },
    dropHeight: { value: "", unit: "mm" },
    source: "",
    testMethod: "",
    temperatureC: "",
    dropSequence: "",
    useRights: "",
    notes: "",
    pointPressureUnit: "kPa",
    points: [
      { pressure: "", accelerationG: "" },
      { pressure: "", accelerationG: "" },
      { pressure: "", accelerationG: "" },
    ],
  };
}

function newConfig(id) {
  return { id, label: "", mode: "area", area: { value: "", unit: "cm2" }, targetPressure: { value: "", unit: "kPa" } };
}

function defaultState() {
  return {
    scenario: { massKg: "2", dropHeight: { value: "762", unit: "mm" }, orientation: "Flat, bottom face" },
    curve: emptyCurve(),
    configurations: [{ ...newConfig("A"), area: { value: "100", unit: "cm2" } }],
    fragility: { enabled: false, criticalG: "", pulseShape: "", pulseDurationMs: "", velocityChangeMps: "", method: "", conditionsConfirmed: false },
  };
}

function syntheticCurve() {
  return {
    datasetId: "SYN-EP01-VERIFY",
    datasetVersion: "1.0.0",
    dataType: "synthetic",
    material: "Synthetic verification data",
    thickness: { value: "50", unit: "mm" },
    dropHeight: { value: "762", unit: "mm" },
    source: "EP01 charter acceptance case",
    testMethod: "None (synthetic)",
    temperatureC: "23",
    dropSequence: "Not applicable",
    useRights: "Not applicable",
    notes: "",
    pointPressureUnit: "kPa",
    points: [
      { pressure: "1", accelerationG: "50" },
      { pressure: "3", accelerationG: "30" },
    ],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    // Shallow structural merge so older saved shapes still load
    return {
      scenario: { ...d.scenario, ...s.scenario, dropHeight: { ...d.scenario.dropHeight, ...(s.scenario?.dropHeight ?? {}) } },
      curve: { ...emptyCurve(), ...s.curve },
      configurations: Array.isArray(s.configurations) && s.configurations.length ? s.configurations.slice(0, MAX_CONFIGURATIONS) : d.configurations,
      fragility: { ...d.fragility, ...s.fragility },
    };
  } catch {
    return defaultState();
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: the calculator still works */
    }
  }, 250);
}

let state = loadState();

// ---------------------------------------------------------------------------
// Engine input from state
// ---------------------------------------------------------------------------

function curveIsEmpty(c) {
  const metaBlank = REQUIRED_CURVE_METADATA.every(([k]) => {
    const v = c[k];
    if (v && typeof v === "object") return String(v.value ?? "").trim() === "";
    return String(v ?? "").trim() === "";
  });
  const pointsBlank = c.points.every((p) => String(p.pressure).trim() === "" && String(p.accelerationG).trim() === "");
  return metaBlank && pointsBlank;
}

function engineInput() {
  const c = state.curve;
  const curve = curveIsEmpty(c)
    ? null
    : {
        ...c,
        // The engine ignores rows left completely blank; partial rows are reported by row number.
        points: c.points.map((p) => ({ pressure: p.pressure, accelerationG: p.accelerationG })),
      };
  return {
    scenario: state.scenario,
    curve,
    configurations: state.configurations.map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      mode: cfg.mode,
      area: cfg.area,
      targetPressure: cfg.targetPressure,
    })),
    fragility: state.fragility.enabled ? state.fragility : null,
  };
}

// ---------------------------------------------------------------------------
// Path helpers for data-bind
// ---------------------------------------------------------------------------

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------------------------------------------------------------------------
// Number formatting (display only)
// ---------------------------------------------------------------------------

function fx(x, d) {
  return Number.isFinite(x) ? x.toFixed(d) : "—";
}

// ---------------------------------------------------------------------------
// Static inputs
// ---------------------------------------------------------------------------

function syncBoundInputs() {
  for (const el of $$("[data-bind]")) {
    const v = getPath(state, el.dataset.bind);
    if (el.type === "checkbox") el.checked = Boolean(v);
    else el.value = v ?? "";
  }
  $("#frag-fields").hidden = !state.fragility.enabled;
}

function onBoundInput(e) {
  const el = e.target.closest("[data-bind]");
  if (!el) return;
  const value = el.type === "checkbox" ? el.checked : el.value;
  setPath(state, el.dataset.bind, value);
  if (el.id === "frag-enabled") $("#frag-fields").hidden = !el.checked;
  if (el.id === "pointUnit") updatePointUnitHeader();
  update();
}

// ---------------------------------------------------------------------------
// Curve points table
// ---------------------------------------------------------------------------

function updatePointUnitHeader() {
  $("#th-pressure").textContent = `Static pressure (${PRESSURE_UNITS[state.curve.pointPressureUnit]?.label ?? "kPa"})`;
}

function renderPoints() {
  updatePointUnitHeader();
  const body = $("#points-body");
  body.innerHTML = state.curve.points
    .map(
      (p, i) => `<tr>
        <td>${i + 1}</td>
        <td><input inputmode="decimal" autocomplete="off" aria-label="Point ${i + 1} static pressure" data-point="${i}" data-key="pressure" value="${esc(p.pressure)}"></td>
        <td><input inputmode="decimal" autocomplete="off" aria-label="Point ${i + 1} peak acceleration" data-point="${i}" data-key="accelerationG" value="${esc(p.accelerationG)}"></td>
        <td><button type="button" class="quiet" data-remove-point="${i}" aria-label="Remove point ${i + 1}">✕</button></td>
      </tr>`,
    )
    .join("");
}

function onPointsInput(e) {
  const el = e.target;
  if (!el.matches("[data-point]")) return;
  state.curve.points[Number(el.dataset.point)][el.dataset.key] = el.value;
  update();
}

function onPointsClick(e) {
  const btn = e.target.closest("[data-remove-point]");
  if (!btn) return;
  const i = Number(btn.dataset.removePoint);
  state.curve.points.splice(i, 1);
  if (state.curve.points.length === 0) state.curve.points.push({ pressure: "", accelerationG: "" });
  renderPoints();
  const next = $(`[data-point="${Math.min(i, state.curve.points.length - 1)}"][data-key="pressure"]`);
  next?.focus();
  update();
}

// ---------------------------------------------------------------------------
// Configurations
// ---------------------------------------------------------------------------

function renderConfigs() {
  const wrap = $("#configs");
  state.configurations.sort((a, b) => a.id.localeCompare(b.id));
  wrap.innerHTML = state.configurations
    .map((c, i) => {
      const shape = markerShape(c.id);
      return `<div class="config" data-id="${c.id}">
        <div class="config-head">
          <h3><span class="marker" data-shape="${shape}" aria-hidden="true"></span>Configuration ${c.id}</h3>
          ${state.configurations.length > 1 ? `<button type="button" class="quiet" data-remove-config="${i}" aria-label="Remove configuration ${c.id}">Remove</button>` : ""}
        </div>
        <div class="field">
          <label for="cfg-label-${c.id}">Name <span class="muted">(optional)</span></label>
          <input id="cfg-label-${c.id}" type="text" autocomplete="off" data-config="${i}" data-path="label" value="${esc(c.label)}" placeholder="e.g. four corner pads">
        </div>
        <div class="field">
          <span class="field-label" id="cfg-mode-${c.id}">Enter</span>
          <div class="segmented" role="radiogroup" aria-labelledby="cfg-mode-${c.id}">
            <input type="radio" id="cfg-${c.id}-m-area" name="cfg-${c.id}-mode" value="area" data-config="${i}" data-path="mode" ${c.mode === "area" ? "checked" : ""}>
            <label for="cfg-${c.id}-m-area">Bearing area</label>
            <input type="radio" id="cfg-${c.id}-m-p" name="cfg-${c.id}-mode" value="pressure" data-config="${i}" data-path="mode" ${c.mode === "pressure" ? "checked" : ""}>
            <label for="cfg-${c.id}-m-p">Target static pressure</label>
          </div>
        </div>
        <div class="field" data-mode-field="area" ${c.mode === "area" ? "" : "hidden"}>
          <label for="cfg-area-${c.id}">Bearing area</label>
          <div class="with-unit">
            <input id="cfg-area-${c.id}" inputmode="decimal" autocomplete="off" data-config="${i}" data-path="area.value" value="${esc(c.area.value)}">
            <select aria-label="Bearing area unit, configuration ${c.id}" data-config="${i}" data-path="area.unit">
              ${["cm2", "mm2", "m2"].map((u) => `<option value="${u}" ${c.area.unit === u ? "selected" : ""}>${{ cm2: "cm²", mm2: "mm²", m2: "m²" }[u]}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field" data-mode-field="pressure" ${c.mode === "pressure" ? "" : "hidden"}>
          <label for="cfg-p-${c.id}">Target static pressure</label>
          <div class="with-unit">
            <input id="cfg-p-${c.id}" inputmode="decimal" autocomplete="off" data-config="${i}" data-path="targetPressure.value" value="${esc(c.targetPressure.value)}">
            <select aria-label="Target pressure unit, configuration ${c.id}" data-config="${i}" data-path="targetPressure.unit">
              ${["kPa", "psi", "Pa"].map((u) => `<option value="${u}" ${c.targetPressure.unit === u ? "selected" : ""}>${u}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>`;
    })
    .join("");
  $("#add-config").disabled = state.configurations.length >= MAX_CONFIGURATIONS;
}

function onConfigInput(e) {
  const el = e.target;
  if (!el.matches("[data-config]")) return;
  const cfg = state.configurations[Number(el.dataset.config)];
  setPath(cfg, el.dataset.path, el.value);
  if (el.dataset.path === "mode") {
    const card = el.closest(".config");
    for (const f of $$("[data-mode-field]", card)) f.hidden = f.dataset.modeField !== cfg.mode;
  }
  update();
}

function onConfigClick(e) {
  const btn = e.target.closest("[data-remove-config]");
  if (!btn) return;
  state.configurations.splice(Number(btn.dataset.removeConfig), 1);
  renderConfigs();
  $("#add-config").focus();
  update();
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

let lastInput = null;
let lastOutput = null;

function pointUnit() {
  const key = state.curve.pointPressureUnit in PRESSURE_UNITS ? state.curve.pointPressureUnit : "kPa";
  return { key, ...PRESSURE_UNITS[key] };
}

function update() {
  lastInput = engineInput();
  lastOutput = evaluate(lastInput);
  renderOutput(lastInput, lastOutput);
  saveState();
}

function renderOutput(input, out) {
  const synthetic = Boolean(out.curve?.synthetic);
  $("#curve-synthetic").hidden = !synthetic;
  $("#result-synthetic").hidden = !synthetic;
  $("#useRightsField").hidden = state.curve.dataType !== "measured-supplier";

  // Scenario field error
  const massErr = out.errors.find((e) => e.code === "mass");
  $("#mass").setAttribute("aria-invalid", massErr ? "true" : "false");
  $("#mass-err").textContent = massErr ? massErr.text : "";

  // Curve field errors (only once the user has started entering a curve)
  const curveErrors = out.curve?.errors ?? [];
  for (const el of $$("[data-curve-field]")) {
    const bad = curveErrors.some((e) => e.field === el.dataset.curveField);
    el.setAttribute("aria-invalid", bad ? "true" : "false");
  }
  for (const el of $$("[data-point]")) el.setAttribute("aria-invalid", "false");
  for (const e of curveErrors) {
    const m = /^points\.(\d+)\.(pressure|accelerationG)$/.exec(e.field ?? "");
    if (m) $(`[data-point="${m[1]}"][data-key="${m[2]}"]`)?.setAttribute("aria-invalid", "true");
  }
  $("#curve-errors").innerHTML = curveErrors.length
    ? `<div class="notice error" style="margin-top:0.875rem"><strong>Fix the curve to enable shock prediction</strong><ul>${curveErrors.map((e) => `<li>${esc(e.text)}</li>`).join("")}</ul></div>`
    : "";

  // Shock status line
  const status = $("#shock-status");
  status.dataset.state = out.shock.enabled ? "on" : out.shock.reason === "no-curve" ? "idle" : "off";
  $("#shock-status-text").textContent = out.shock.message;

  // Plot
  const u = pointUnit();
  const fragActive = out.fragility?.status === "active";
  const plot = renderPlot({
    compact: $("#plot").clientWidth < 520,
    unit: u,
    curvePoints: out.curve && out.curve.pointsSI.length >= 2 && out.curve.usable ? out.curve.pointsSI : null,
    shockEnabled: out.shock.enabled,
    synthetic,
    configs: out.configurations,
    fragilityG: fragActive ? out.fragility.criticalG : null,
  });
  $("#plot").innerHTML = plot.svg;
  $("#plot-caption").textContent = out.curve?.usable
    ? "Straight lines join the measured points. Hatched zones are outside the measured pressure range, where no peak acceleration is reported."
    : "Static pressure for each configuration is marked on the axis. Peak acceleration needs a complete, measured cushion curve.";

  renderResultsTable(out, u);
  renderRecord(input, out);
}

function renderResultsTable(out, u) {
  const cfgs = out.configurations;
  const fragActive = out.fragility?.status === "active";
  const showPsi = u.key === "psi";
  const head = cfgs
    .map((c) => `<th scope="col" data-id="${c.id}"><span class="marker" data-shape="${markerShape(c.id)}" aria-hidden="true"></span>${esc(c.label === `Configuration ${c.id}` ? c.id : `${c.id}: ${c.label}`)}</th>`)
    .join("");

  const cell = (c, fn) => (c.status === "error" ? `<td><span class="na">Check input</span></td>` : `<td>${fn(c)}</td>`);

  const rows = [];
  rows.push(
    `<tr><th scope="row">Bearing area</th>${cfgs
      .map((c) =>
        cell(c, (c) => {
          const cm2 = c.bearingAreaM2 / 1e-4;
          const mm2 = c.bearingAreaM2 / 1e-6;
          return `<span class="primary-num">${fx(cm2, 2)} cm²</span><span class="sub-num">${fx(mm2, 2)} mm²${c.mode === "pressure" ? ", required" : ", entered"}</span>`;
        }),
      )
      .join("")}</tr>`,
  );
  rows.push(
    `<tr><th scope="row">Static pressure</th>${cfgs
      .map((c) =>
        cell(c, (c) => {
          const kpa = c.staticPressurePa / 1000;
          const psi = c.staticPressurePa / PRESSURE_UNITS.psi.toSI;
          return `<span class="primary-num">${fx(kpa, 3)} kPa</span><span class="sub-num">${fx(c.staticPressurePa, 2)} Pa${showPsi ? `, ${fx(psi, 3)} psi` : ""}</span>`;
        }),
      )
      .join("")}</tr>`,
  );
  rows.push(
    `<tr><th scope="row">Peak acceleration</th>${cfgs
      .map((c) => {
        if (c.status === "error") return `<td><span class="na">Check input</span></td>`;
        if (c.shockStatus === "interpolated") return `<td><span class="primary-num">${fx(c.peakAccelerationG, 1)} g</span><span class="sub-num">${c.interpolation?.exact ? "measured point" : "interpolated"}</span></td>`;
        if (c.shockStatus === "out-of-range") return `<td><span class="na">Outside curve data</span></td>`;
        return `<td><span class="na">Not available</span></td>`;
      })
      .join("")}</tr>`,
  );
  if (fragActive) {
    rows.push(
      `<tr><th scope="row">Against fragility</th>${cfgs
        .map((c) => {
          const cmp = out.fragility.comparisons.find((x) => x.id === c.id);
          if (!cmp) return `<td><span class="na">Not available</span></td>`;
          const word = cmp.belowFragility ? "below" : "at or above";
          return `<td><span class="primary-num">${fx(Math.abs(cmp.marginG), 1)} g ${word}</span><span class="sub-num">${fx(cmp.ratio * 100, 0)} % of ${fx(out.fragility.criticalG, 1)} g</span></td>`;
        })
        .join("")}</tr>`,
    );
  }

  $("#results-table").innerHTML = cfgs.length
    ? `<table class="results-table"><caption class="visually-hidden">Results by configuration</caption><thead><tr><th scope="col"><span class="visually-hidden">Quantity</span></th>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<p class="muted">Add a configuration to see results.</p>`;

  const msgs = [];
  for (const c of cfgs) for (const m of c.messages) msgs.push(`<li class="notice ${c.status === "error" ? "error" : ""}" data-id="${c.id}"><strong>${c.id}.</strong> ${esc(m.text)}</li>`);
  $("#result-messages").innerHTML = msgs.join("");

  const cand = out.candidate;
  $("#candidate").innerHTML = cand
    ? `Lowest measured peak on this curve: <strong>${fx(cand.accelerationG, 1)} g</strong> at ${fx(cand.pressurePa / 1000, 3)} kPa. Putting the load there needs a bearing area of <strong>${fx(cand.bearingAreaM2 / 1e-4, 2)} cm²</strong>.`
    : "";

  const f = out.fragility;
  let fragHtml = "";
  if (f) {
    const text = {
      active: "",
      invalid: "Enter a critical acceleration greater than zero to compare.",
      incomplete: "Add the pulse shape, pulse duration and test method to compare.",
      unconfirmed: "Confirm that the fragility pulse is compatible with the cushion test conditions to show the comparison.",
      "no-shock": "Fragility can be compared once a peak acceleration is available.",
      inactive: "",
    }[f.status];
    fragHtml = text ? `<p class="notice" style="margin-top:0.875rem">${esc(text)}</p>` : `<p class="small muted" style="margin-top:0.75rem">${esc(f.note)}</p>`;
  }
  $("#fragility-result").innerHTML = fragHtml;
}

function lenText(l) {
  return l && String(l.value).trim() !== "" ? `${l.value} ${l.unit}` : "";
}

function renderRecord(input, out) {
  const s = input.scenario;
  const c = input.curve;
  const rows = [
    ["Supported mass", s.massKg ? `${s.massKg} kg` : ""],
    ["Scenario drop height", lenText(s.dropHeight)],
    ["Orientation", s.orientation],
  ];
  if (c) {
    rows.push(
      ["Data type", CURVE_DATA_TYPES[c.dataType] ?? ""],
      ["Dataset", [c.datasetId, c.datasetVersion && `version ${c.datasetVersion}`].filter(Boolean).join(", ")],
      ["Material", c.material],
      ["Thickness", lenText(c.thickness)],
      ["Test drop height", lenText(c.dropHeight)],
      ["Source", c.source],
      ["Test method", c.testMethod],
      ["Test temperature", String(c.temperatureC ?? "").trim() !== "" ? `${c.temperatureC} °C` : ""],
      ["Drop sequence", c.dropSequence],
    );
    if (c.dataType === "measured-supplier") rows.push(["Use rights", c.useRights]);
    const r = out.curve?.rangePa;
    if (r) {
      const u = pointUnit();
      rows.push(["Points", `${out.curve.pointsSI.length}, from ${fx(r[0] / u.toSI, 3)} to ${fx(r[1] / u.toSI, 3)} ${u.label}`]);
    }
  } else {
    rows.push(["Cushion curve", "None entered (static-loading results only)"]);
  }
  rows.push(["Calculator", `${CALCULATOR_ID}, engine ${ENGINE_VERSION}, specification ${SPEC_VERSION}`]);
  $("#record").innerHTML = `<dl class="record">${rows
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v && String(v).trim() ? esc(v) : `<span class="muted">Not recorded</span>`}</dd>`)
    .join("")}</dl>`;

  // Applicability checks
  const checks = [];
  if (c) {
    const errs = out.curve.errors;
    checks.push([!errs.some((e) => e.code === "metadata-missing"), "Curve metadata complete"]);
    checks.push([!errs.some((e) => /^points/.test(e.code) || e.code === "point-invalid"), "At least two valid points, no duplicate pressures"]);
    if (out.curve.usable) {
      const dm = out.shock.reason;
      checks.push([dm === "ok", dm === "drop-height-missing" ? "Scenario drop height entered" : "Scenario drop height matches the curve's test drop height"]);
    }
    checks.push([c.dataType !== "synthetic" && Boolean(c.dataType), c.dataType === "synthetic" ? "Material evidence (synthetic data is not)" : "Measured data"]);
    if (c.dataType === "measured-supplier") checks.push([String(c.useRights ?? "").trim() !== "", "Use rights recorded for supplier data"]);
    if (out.shock.enabled) {
      const inRange = out.configurations.filter((x) => x.status === "ok").every((x) => x.shockStatus === "interpolated");
      checks.push([inRange, "Every configuration lies within the measured pressure range"]);
    }
  }
  $("#checks").innerHTML = checks.map(([pass, text]) => `<li data-pass="${pass}"><span>${esc(text)}</span></li>`).join("");

  const warn = [...out.warnings.filter((w) => w.code !== "synthetic"), ...out.errors.filter((e) => e.code !== "mass")];
  $("#warnings").innerHTML = warn.length ? `<div class="notice"><strong>Notes</strong><ul>${warn.map((w) => `<li>${esc(w.text)}</li>`).join("")}</ul></div>` : "";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const now = new Date();
  const record = buildExportRecord(lastInput, lastOutput, now.toISOString());
  const stamp = now.toISOString().replace(/[:]/g, "").replace(/\.\d+Z$/, "Z");
  download(`${CALCULATOR_ID}_${stamp}.json`, JSON.stringify(record, null, 2), "application/json");
}

function buildPrintSummary() {
  const out = lastOutput;
  const input = lastInput;
  const rec = buildExportRecord(input, out);
  const u = pointUnit();
  const resRows = out.configurations
    .map(
      (c) => `<tr><td>${esc(c.id)}${c.label !== `Configuration ${c.id}` ? `: ${esc(c.label)}` : ""}</td><td>${c.mode === "pressure" ? "Target pressure" : "Bearing area"}</td>
      <td>${fx(c.bearingAreaM2 / 1e-4, 2)} cm²</td><td>${fx(c.staticPressurePa / 1000, 3)} kPa (${fx(c.staticPressurePa, 2)} Pa)</td>
      <td>${c.shockStatus === "interpolated" ? `${fx(c.peakAccelerationG, 1)} g` : c.shockStatus === "out-of-range" ? "Outside curve data" : "Not available"}</td></tr>`,
    )
    .join("");
  const plot = renderPlot({
    unit: u,
    curvePoints: out.curve?.usable ? out.curve.pointsSI : null,
    shockEnabled: out.shock.enabled,
    synthetic: Boolean(out.curve?.synthetic),
    configs: out.configurations,
    fragilityG: out.fragility?.status === "active" ? out.fragility.criticalG : null,
  });
  $("#print-summary").innerHTML = `
    <p><strong>${esc(CALCULATOR_ID)}</strong>, engine ${ENGINE_VERSION}, specification ${SPEC_VERSION}. Generated ${esc(new Date().toLocaleString())}.</p>
    ${out.curve?.synthetic ? `<p class="synthetic-band">Synthetic verification data. Not material evidence.</p>` : ""}
    <section><h2>Results</h2><table><thead><tr><th>Configuration</th><th>Entered</th><th>Bearing area</th><th>Static pressure</th><th>Peak acceleration</th></tr></thead><tbody>${resRows}</tbody></table>
    <p>${esc(out.shock.message)}</p></section>
    <section><h2>Cushion curve and operating points</h2>${plot.svg}</section>
    <section><h2>Source and applicability</h2>${$("#record").innerHTML}</section>
    ${rec.warnings.length ? `<section><h2>Warnings</h2><ul>${rec.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>` : ""}
    <section><h2>Assumptions</h2><ul>${rec.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>
    <p><em>${esc(rec.disclaimer)}</em></p>`;
}

function importCsv(text) {
  const status = $("#csv-status");
  const r = parseCurveCsv(text);
  if (r.errors.length) {
    status.innerHTML = `<div class="notice error"><strong>Nothing imported.</strong><ul>${r.errors.map((e) => `<li>${esc(e.text)}</li>`).join("")}</ul></div>`;
    return;
  }
  state.curve.points = r.points.map((p) => ({ pressure: String(p.pressure), accelerationG: String(p.accelerationG) }));
  renderPoints();
  status.innerHTML = `<p class="notice ok">Imported ${r.points.length} points in ${esc(PRESSURE_UNITS[state.curve.pointPressureUnit].label)}. Check the unit above matches your file.</p>`;
  update();
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

function renderAll() {
  syncBoundInputs();
  renderPoints();
  renderConfigs();
  update();
}

function init() {
  $("#version-tag").textContent = `Engine ${ENGINE_VERSION}`;
  document.addEventListener("input", onBoundInput);
  document.addEventListener("change", (e) => {
    if (e.target.matches("select[data-bind], input[type=checkbox][data-bind]")) onBoundInput(e);
  });
  $("#points-body").addEventListener("input", onPointsInput);
  $("#points-body").addEventListener("click", onPointsClick);
  $("#configs").addEventListener("input", onConfigInput);
  $("#configs").addEventListener("change", (e) => {
    if (e.target.matches("select[data-config], input[type=radio][data-config]")) onConfigInput(e);
  });
  $("#configs").addEventListener("click", onConfigClick);

  $("#add-point").addEventListener("click", () => {
    state.curve.points.push({ pressure: "", accelerationG: "" });
    renderPoints();
    $(`[data-point="${state.curve.points.length - 1}"][data-key="pressure"]`).focus();
    update();
  });
  $("#load-synthetic").addEventListener("click", () => {
    state.curve = syntheticCurve();
    syncBoundInputs();
    renderPoints();
    update();
  });
  $("#clear-curve").addEventListener("click", () => {
    state.curve = emptyCurve();
    syncBoundInputs();
    renderPoints();
    $("#csv-status").innerHTML = "";
    update();
  });
  $("#add-config").addEventListener("click", () => {
    const used = new Set(state.configurations.map((c) => c.id));
    const id = IDS.find((x) => !used.has(x));
    if (!id) return;
    state.configurations.push(newConfig(id));
    renderConfigs();
    $(`#cfg-area-${id}`).focus();
    update();
  });
  $("#csv-import").addEventListener("click", () => importCsv($("#csv-text").value));
  $("#csv-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importCsv(await file.text());
    e.target.value = "";
  });
  $("#export-json").addEventListener("click", exportJson);
  $("#print-summary-btn").addEventListener("click", () => {
    buildPrintSummary();
    window.print();
  });
  window.addEventListener("beforeprint", buildPrintSummary);
  let resizeTimer = null;
  let wasCompact = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const compact = $("#plot").clientWidth < 520;
      if (compact !== wasCompact) {
        wasCompact = compact;
        renderOutput(lastInput, lastOutput);
      }
    }, 150);
  });
  $("#reset-all").addEventListener("click", () => {
    state = defaultState();
    $("#csv-status").innerHTML = "";
    renderAll();
  });

  renderAll();
}

init();
