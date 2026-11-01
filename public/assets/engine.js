/**
 * EP01 Cushion Bearing Area and Shock Response — calculation engine.
 *
 * Pure functions only: no DOM, no network, no randomness. The browser
 * interface and the automated verification tests both import this file,
 * so what is verified is exactly what runs.
 *
 * All internal quantities are SI (kg, m, m², Pa) except peak acceleration,
 * which stays in multiples of standard gravity (g) because that is how
 * cushion curves and fragility values are reported.
 *
 * Specification: docs/calculation-spec.md (same version as ENGINE_VERSION).
 */

export const CALCULATOR_ID = "ep01-cushion-bearing-area";
export const ENGINE_VERSION = "0.1.0";
export const SPEC_VERSION = "0.1.0";

/** Standard acceleration of gravity, m/s² (exact by definition). */
export const STANDARD_GRAVITY = 9.80665;

/** Maximum number of configurations compared at once (charter V0.1). */
export const MAX_CONFIGURATIONS = 3;

/** Relative tolerance used to decide that a scenario drop height matches the curve's test drop height. */
export const DROP_HEIGHT_MATCH_TOLERANCE = 0.01;

/** Relative tolerance used to decide that two curve points share the same static pressure. */
export const DUPLICATE_PRESSURE_TOLERANCE = 1e-9;

/** Unit conversion factors to SI. */
export const AREA_UNITS = Object.freeze({
  mm2: { toSI: 1e-6, label: "mm²" },
  cm2: { toSI: 1e-4, label: "cm²" },
  m2: { toSI: 1, label: "m²" },
});

export const PRESSURE_UNITS = Object.freeze({
  Pa: { toSI: 1, label: "Pa" },
  kPa: { toSI: 1000, label: "kPa" },
  // 1 lbf/in² = 4.4482216152605 N / (0.0254 m)² = 6894.757293168361 Pa (exact by definition of lbf and inch)
  psi: { toSI: 6894.757293168361, label: "psi" },
});

export const LENGTH_UNITS = Object.freeze({
  mm: { toSI: 1e-3, label: "mm" },
  cm: { toSI: 1e-2, label: "cm" },
  m: { toSI: 1, label: "m" },
  in: { toSI: 0.0254, label: "in" },
});

/** Evidence classes a curve dataset can carry. Synthetic data is never material evidence. */
export const CURVE_DATA_TYPES = Object.freeze({
  "measured-supplier": "Measured, supplier published data",
  "measured-in-house": "Measured, in-house test data",
  synthetic: "Synthetic, verification only (not material evidence)",
});

/** Curve metadata fields that must be present before a curve can be used for shock prediction. */
export const REQUIRED_CURVE_METADATA = Object.freeze([
  ["datasetId", "Dataset ID"],
  ["datasetVersion", "Dataset version"],
  ["dataType", "Data type"],
  ["material", "Material"],
  ["thickness", "Thickness"],
  ["dropHeight", "Test drop height"],
  ["source", "Curve source"],
  ["testMethod", "Test method"],
  ["temperatureC", "Test temperature"],
  ["dropSequence", "Drop sequence"],
]);

export const ASSUMPTIONS = Object.freeze([
  "Static pressure p = m·g / A with g = 9.80665 m/s².",
  "Bearing area is the actual supporting area of the cushion for the selected orientation, entered by the user.",
  "Transmitted peak acceleration is read from measured cushion-curve points at the computed static pressure by piecewise linear interpolation between adjacent points only.",
  "No extrapolation outside the pressure range of the curve data; no interpolation across thicknesses or drop heights.",
  "Peak acceleration is not derived from foam density or from any material preset.",
  "Cushion-curve data describe the cushion material under its test conditions; assembled-package performance may differ.",
  "A fragility comparison is conditional on compatible shock conditions and is not a shipping qualification.",
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** True for finite numbers (rejects NaN, ±Infinity, strings, null). */
export function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Parse a user-entered numeric string. Returns NaN for empty or malformed input. */
export function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const trimmed = value.trim().replace(/−/g, "-");
  if (trimmed === "") return NaN;
  // Accept plain decimal and exponent notation only (no thousands separators, no units).
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return NaN;
  return Number(trimmed);
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function relDiff(a, b) {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

export function toSI(value, unit, table) {
  const entry = table[unit];
  if (!entry) throw new EngineError("unit", `Unknown unit "${unit}".`);
  return value * entry.toSI;
}

export function fromSI(valueSI, unit, table) {
  const entry = table[unit];
  if (!entry) throw new EngineError("unit", `Unknown unit "${unit}".`);
  return valueSI / entry.toSI;
}

export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Core equations
// ---------------------------------------------------------------------------

/**
 * Static pressure on the cushion, Pa.
 * p = m × g / A
 */
export function staticPressure(massKg, areaM2) {
  if (!isFiniteNumber(massKg) || massKg <= 0) {
    throw new EngineError("mass", "Supported mass must be a number greater than zero.");
  }
  if (!isFiniteNumber(areaM2) || areaM2 <= 0) {
    throw new EngineError("area", "Bearing area must be a number greater than zero.");
  }
  return (massKg * STANDARD_GRAVITY) / areaM2;
}

/**
 * Bearing area required to produce a target static pressure, m².
 * A = m × g / p
 */
export function requiredArea(massKg, pressurePa) {
  if (!isFiniteNumber(massKg) || massKg <= 0) {
    throw new EngineError("mass", "Supported mass must be a number greater than zero.");
  }
  if (!isFiniteNumber(pressurePa) || pressurePa <= 0) {
    throw new EngineError("pressure", "Target static pressure must be a number greater than zero.");
  }
  return (massKg * STANDARD_GRAVITY) / pressurePa;
}

// ---------------------------------------------------------------------------
// Cushion curve validation and interpolation
// ---------------------------------------------------------------------------

/**
 * Validate a cushion curve and return its points sorted by static pressure (SI).
 *
 * curve = {
 *   datasetId, datasetVersion, dataType, material,
 *   thickness: { value, unit }, dropHeight: { value, unit },
 *   source, testMethod, temperatureC, dropSequence, notes?,
 *   pointPressureUnit: "kPa" | "psi" | "Pa",
 *   points: [{ pressure, accelerationG }]
 * }
 *
 * Returns { usable, errors[], warnings[], pointsSI[] } where pointsSI are
 * { pressurePa, accelerationG } sorted ascending by pressure.
 */
export function validateCurve(curve) {
  const errors = [];
  const warnings = [];

  if (!curve || typeof curve !== "object") {
    return { usable: false, errors: [msg("curve-missing", "No cushion curve has been provided.")], warnings, pointsSI: [] };
  }

  // Metadata
  for (const [key, label] of REQUIRED_CURVE_METADATA) {
    const v = curve[key];
    if (key === "thickness" || key === "dropHeight") {
      const value = v ? parseNumber(v.value) : NaN;
      if (!v || !isFiniteNumber(value) || value <= 0 || !LENGTH_UNITS[v.unit]) {
        errors.push(msg("metadata-missing", `${label} is required and must be greater than zero.`, key));
      }
    } else if (key === "temperatureC") {
      if (!isFiniteNumber(parseNumber(v))) {
        errors.push(msg("metadata-missing", `${label} is required (°C).`, key));
      }
    } else if (key === "dataType") {
      if (!CURVE_DATA_TYPES[v]) errors.push(msg("metadata-missing", `${label} is required.`, key));
    } else if (isBlank(v)) {
      errors.push(msg("metadata-missing", `${label} is required.`, key));
    }
  }

  const unit = curve.pointPressureUnit;
  if (!PRESSURE_UNITS[unit]) {
    errors.push(msg("unit", "Curve pressure unit must be Pa, kPa or psi.", "pointPressureUnit"));
  }

  // Points
  const raw = Array.isArray(curve.points) ? curve.points : [];
  const pointsSI = [];
  let enteredRows = 0;
  raw.forEach((pt, i) => {
    // Rows left completely blank are ignored (row numbers keep their table position).
    if (isBlank(pt?.pressure) && isBlank(pt?.accelerationG)) return;
    enteredRows += 1;
    const p = parseNumber(pt?.pressure);
    const a = parseNumber(pt?.accelerationG);
    const row = i + 1;
    if (!isFiniteNumber(p) || p <= 0) {
      errors.push(msg("point-invalid", `Point ${row}: static pressure must be a number greater than zero.`, `points.${i}.pressure`));
      return;
    }
    if (!isFiniteNumber(a) || a <= 0) {
      errors.push(msg("point-invalid", `Point ${row}: peak acceleration must be a number greater than zero.`, `points.${i}.accelerationG`));
      return;
    }
    if (PRESSURE_UNITS[unit]) pointsSI.push({ pressurePa: p * PRESSURE_UNITS[unit].toSI, accelerationG: a, row });
  });

  if (enteredRows < 2) {
    errors.push(msg("points-too-few", "A curve needs at least two measured points."));
  }

  // Order check (informational) then sort
  let wasSorted = true;
  for (let i = 1; i < pointsSI.length; i++) {
    if (pointsSI[i].pressurePa < pointsSI[i - 1].pressurePa) wasSorted = false;
  }
  pointsSI.sort((a, b) => a.pressurePa - b.pressurePa);
  if (!wasSorted) {
    warnings.push(msg("points-reordered", "Curve points were not in ascending pressure order; they have been sorted for interpolation."));
  }

  // Duplicate pressures are rejected: interpolation between them would be undefined.
  for (let i = 1; i < pointsSI.length; i++) {
    if (relDiff(pointsSI[i].pressurePa, pointsSI[i - 1].pressurePa) <= DUPLICATE_PRESSURE_TOLERANCE) {
      errors.push(
        msg(
          "points-duplicate",
          `Points ${pointsSI[i - 1].row} and ${pointsSI[i].row} have the same static pressure. Remove or average duplicates before use.`,
        ),
      );
    }
  }

  if (curve.dataType === "synthetic") {
    warnings.push(msg("synthetic", "This curve is synthetic verification data. It is not material evidence and must not be used for design decisions."));
  }
  if (curve.dataType === "measured-supplier" && isBlank(curve.useRights)) {
    warnings.push(msg("use-rights", "Supplier data: record the use rights and review the test conditions before releasing results based on this curve."));
  }

  return { usable: errors.length === 0, errors, warnings, pointsSI: pointsSI.map(({ pressurePa, accelerationG }) => ({ pressurePa, accelerationG })) };
}

/**
 * Piecewise linear interpolation of peak acceleration at a static pressure.
 * Points must be validated, sorted ascending and free of duplicates.
 *
 * Returns { status: "ok", accelerationG, segment: [i, j], exact }
 *      or { status: "below-range" | "above-range", minPa, maxPa }
 */
export function interpolatePeakAcceleration(pointsSI, pressurePa) {
  if (!Array.isArray(pointsSI) || pointsSI.length < 2) {
    throw new EngineError("points-too-few", "A curve needs at least two measured points.");
  }
  if (!isFiniteNumber(pressurePa) || pressurePa <= 0) {
    throw new EngineError("pressure", "Static pressure must be a number greater than zero.");
  }
  const n = pointsSI.length;
  const minPa = pointsSI[0].pressurePa;
  const maxPa = pointsSI[n - 1].pressurePa;

  if (pressurePa < minPa) return { status: "below-range", minPa, maxPa };
  if (pressurePa > maxPa) return { status: "above-range", minPa, maxPa };

  for (let i = 0; i < n; i++) {
    if (pointsSI[i].pressurePa === pressurePa) {
      return { status: "ok", accelerationG: pointsSI[i].accelerationG, segment: [i, i], exact: true };
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const p0 = pointsSI[i].pressurePa;
    const p1 = pointsSI[i + 1].pressurePa;
    if (pressurePa > p0 && pressurePa < p1) {
      const a0 = pointsSI[i].accelerationG;
      const a1 = pointsSI[i + 1].accelerationG;
      const t = (pressurePa - p0) / (p1 - p0);
      return { status: "ok", accelerationG: a0 + t * (a1 - a0), segment: [i, i + 1], exact: false };
    }
  }
  // Unreachable for validated input.
  throw new EngineError("interpolation", "Interpolation failed: curve points are not sorted or contain duplicates.");
}

/** The measured point with the lowest peak acceleration (first one if tied). */
export function lowestMeasuredPoint(pointsSI) {
  let best = null;
  pointsSI.forEach((pt, i) => {
    if (!best || pt.accelerationG < best.accelerationG) best = { ...pt, index: i };
  });
  return best;
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/**
 * Parse two-column CSV text (static pressure, peak acceleration).
 * Accepts comma, semicolon or tab separators and an optional header row.
 * Returns { points: [{pressure, accelerationG}], errors: [] }. Values stay as
 * entered (in the curve's pressure unit); validation happens in validateCurve.
 */
export function parseCurveCsv(text) {
  const points = [];
  const errors = [];
  if (typeof text !== "string" || text.trim() === "") {
    return { points, errors: [msg("csv-empty", "The CSV is empty.")] };
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let headerSkipped = false;
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const cells = trimmed.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) {
      errors.push(msg("csv-row", `Line ${idx + 1}: expected two values (pressure, peak acceleration).`));
      return;
    }
    const p = parseNumber(cells[0]);
    const a = parseNumber(cells[1]);
    if (!isFiniteNumber(p) || !isFiniteNumber(a)) {
      if (!headerSkipped && points.length === 0 && errors.length === 0) {
        headerSkipped = true; // first non-numeric row is treated as a header
        return;
      }
      errors.push(msg("csv-row", `Line ${idx + 1}: "${trimmed}" is not two numbers.`));
      return;
    }
    if (cells.length > 2 && cells.slice(2).some((c) => c !== "")) {
      errors.push(msg("csv-row", `Line ${idx + 1}: only two columns are read; extra values were found.`));
      return;
    }
    points.push({ pressure: p, accelerationG: a });
  });
  if (points.length === 0 && errors.length === 0) errors.push(msg("csv-empty", "No numeric rows were found."));
  return { points, errors };
}

// ---------------------------------------------------------------------------
// Full evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a complete calculator input.
 *
 * input = {
 *   scenario: { massKg, dropHeight: {value, unit}, orientation },
 *   curve: <see validateCurve> | null,
 *   configurations: [{ id, label, mode: "area" | "pressure", area: {value, unit}, targetPressure: {value, unit} }],
 *   fragility: { enabled, criticalG, pulseShape, pulseDurationMs, velocityChangeMps, method, conditionsConfirmed } | null
 * }
 *
 * Returns a plain object; see public/schema/output.schema.json.
 */
export function evaluate(input) {
  const warnings = [];
  const errors = [];
  const scenario = input?.scenario ?? {};

  // Scenario
  const massKg = parseNumber(scenario.massKg);
  const massOk = isFiniteNumber(massKg) && massKg > 0;
  if (!massOk) errors.push(msg("mass", "Supported mass must be a number greater than zero.", "scenario.massKg"));

  let scenarioDropM = null;
  const dh = scenario.dropHeight;
  if (dh && !isBlank(dh.value)) {
    const v = parseNumber(dh.value);
    if (isFiniteNumber(v) && v > 0 && LENGTH_UNITS[dh.unit]) scenarioDropM = toSI(v, dh.unit, LENGTH_UNITS);
    else errors.push(msg("drop-height", "Scenario drop height must be a number greater than zero.", "scenario.dropHeight"));
  }
  if (isBlank(scenario.orientation)) {
    warnings.push(msg("orientation", "Orientation is not recorded. Bearing area must be the supporting area for a defined orientation."));
  }

  // Curve
  let curveCheck = null;
  let shock = { enabled: false, reason: "no-curve", message: "No cushion curve entered. Static-loading results only; shock prediction is disabled." };
  if (input?.curve) {
    curveCheck = validateCurve(input.curve);
    warnings.push(...curveCheck.warnings);
    if (!curveCheck.usable) {
      shock = {
        enabled: false,
        reason: "curve-invalid",
        message: "The cushion curve is incomplete or invalid. Shock prediction is disabled until the problems shown with the curve inputs are fixed.",
      };
    } else {
      const curveDropM = toSI(parseNumber(input.curve.dropHeight.value), input.curve.dropHeight.unit, LENGTH_UNITS);
      if (scenarioDropM === null) {
        shock = {
          enabled: false,
          reason: "drop-height-missing",
          message: "Enter the scenario drop height so it can be checked against the curve's test drop height.",
        };
      } else if (relDiff(scenarioDropM, curveDropM) > DROP_HEIGHT_MATCH_TOLERANCE) {
        shock = {
          enabled: false,
          reason: "drop-height-mismatch",
          message: `The curve was measured at a ${fmtLen(curveDropM)} drop but the scenario drop is ${fmtLen(scenarioDropM)}. Cushion curves do not transfer between drop heights, so shock prediction is disabled.`,
        };
      } else {
        shock = { enabled: true, reason: "ok", message: "Curve applies to the scenario drop height." };
      }
    }
  }

  // Configurations
  const configsIn = Array.isArray(input?.configurations) ? input.configurations : [];
  if (configsIn.length > MAX_CONFIGURATIONS) {
    errors.push(msg("configurations", `At most ${MAX_CONFIGURATIONS} configurations can be compared.`));
  }
  const results = configsIn.slice(0, MAX_CONFIGURATIONS).map((cfg, i) => evaluateConfiguration(cfg, i, massOk ? massKg : null, shock, curveCheck));

  // Lowest measured point on the curve (a candidate operating point taken directly from data)
  let candidate = null;
  if (shock.enabled && massOk) {
    const best = lowestMeasuredPoint(curveCheck.pointsSI);
    candidate = {
      pressurePa: best.pressurePa,
      accelerationG: best.accelerationG,
      bearingAreaM2: requiredArea(massKg, best.pressurePa),
      atCurveBoundary: best.index === 0 || best.index === curveCheck.pointsSI.length - 1,
    };
    if (candidate.atCurveBoundary) {
      warnings.push(
        msg(
          "candidate-boundary",
          "The lowest measured peak acceleration is at the edge of the curve data. A lower value may exist outside the measured range; this tool does not extrapolate to find it.",
        ),
      );
    }
  }

  // Fragility comparison
  const frag = evaluateFragility(input?.fragility, results, shock);
  warnings.push(...frag.warnings);

  return {
    calculatorId: CALCULATOR_ID,
    engineVersion: ENGINE_VERSION,
    specVersion: SPEC_VERSION,
    constants: { standardGravity: STANDARD_GRAVITY },
    scenario: { massKg: massOk ? massKg : null, dropHeightM: scenarioDropM, orientation: scenario.orientation ?? "" },
    curve: curveCheck
      ? {
          usable: curveCheck.usable,
          dataType: input.curve.dataType ?? null,
          synthetic: input.curve.dataType === "synthetic",
          pointsSI: curveCheck.pointsSI,
          rangePa: curveCheck.pointsSI.length ? [curveCheck.pointsSI[0].pressurePa, curveCheck.pointsSI[curveCheck.pointsSI.length - 1].pressurePa] : null,
          errors: curveCheck.errors,
        }
      : null,
    shock,
    configurations: results,
    candidate,
    fragility: frag.summary,
    errors,
    warnings,
    assumptions: [...ASSUMPTIONS],
  };
}

function evaluateConfiguration(cfg, index, massKg, shock, curveCheck) {
  const id = cfg?.id ?? String.fromCharCode(65 + index);
  const label = isBlank(cfg?.label) ? `Configuration ${id}` : String(cfg.label);
  const out = {
    id,
    label,
    mode: cfg?.mode === "pressure" ? "pressure" : "area",
    status: "ok",
    staticPressurePa: null,
    bearingAreaM2: null,
    peakAccelerationG: null,
    shockStatus: shock.enabled ? "pending" : "disabled",
    messages: [],
  };

  if (massKg === null) {
    out.status = "error";
    out.messages.push(msg("mass", "Enter a supported mass greater than zero."));
    out.shockStatus = "disabled";
    return out;
  }

  try {
    if (out.mode === "area") {
      const v = parseNumber(cfg?.area?.value);
      if (!isFiniteNumber(v) || v <= 0) throw new EngineError("area", "Bearing area must be a number greater than zero.");
      out.bearingAreaM2 = toSI(v, cfg.area.unit, AREA_UNITS);
      out.staticPressurePa = staticPressure(massKg, out.bearingAreaM2);
    } else {
      const v = parseNumber(cfg?.targetPressure?.value);
      if (!isFiniteNumber(v) || v <= 0) throw new EngineError("pressure", "Target static pressure must be a number greater than zero.");
      out.staticPressurePa = toSI(v, cfg.targetPressure.unit, PRESSURE_UNITS);
      out.bearingAreaM2 = requiredArea(massKg, out.staticPressurePa);
    }
  } catch (e) {
    out.status = "error";
    out.shockStatus = "disabled";
    out.messages.push(msg(e.code ?? "error", e.message));
    return out;
  }

  if (!shock.enabled) return out;

  const r = interpolatePeakAcceleration(curveCheck.pointsSI, out.staticPressurePa);
  if (r.status === "ok") {
    out.peakAccelerationG = r.accelerationG;
    out.shockStatus = "interpolated";
    out.interpolation = { segment: r.segment, exact: r.exact };
  } else {
    out.shockStatus = "out-of-range";
    out.messages.push(
      msg(
        "extrapolation",
        `Static pressure ${fmtPa(out.staticPressurePa)} is ${r.status === "below-range" ? "below" : "above"} the curve data (${fmtPa(r.minPa)} to ${fmtPa(r.maxPa)}). Extrapolation is not permitted, so no peak acceleration is reported.`,
      ),
    );
  }
  return out;
}

function evaluateFragility(fragility, results, shock) {
  const warnings = [];
  if (!fragility || !fragility.enabled) return { summary: null, warnings };
  const criticalG = parseNumber(fragility.criticalG);
  const summary = {
    criticalG: isFiniteNumber(criticalG) && criticalG > 0 ? criticalG : null,
    pulseShape: fragility.pulseShape ?? "",
    pulseDurationMs: isFiniteNumber(parseNumber(fragility.pulseDurationMs)) ? parseNumber(fragility.pulseDurationMs) : null,
    velocityChangeMps: isFiniteNumber(parseNumber(fragility.velocityChangeMps)) ? parseNumber(fragility.velocityChangeMps) : null,
    method: fragility.method ?? "",
    conditionsConfirmed: fragility.conditionsConfirmed === true,
    comparisons: [],
    status: "inactive",
    note: "Conditional comparison only. This is not a shipping qualification.",
  };
  if (summary.criticalG === null) {
    summary.status = "invalid";
    warnings.push(msg("fragility", "Product fragility must be a number greater than zero to compare."));
    return { summary, warnings };
  }
  if (isBlank(summary.pulseShape) || summary.pulseDurationMs === null || isBlank(summary.method)) {
    summary.status = "incomplete";
    warnings.push(msg("fragility-context", "Fragility needs its pulse shape, pulse duration and test method before it can be compared."));
    return { summary, warnings };
  }
  if (!summary.conditionsConfirmed) {
    summary.status = "unconfirmed";
    warnings.push(msg("fragility-unconfirmed", "Confirm that the fragility pulse conditions are compatible with the cushion test conditions to show the comparison."));
    return { summary, warnings };
  }
  if (!shock.enabled) {
    summary.status = "no-shock";
    return { summary, warnings };
  }
  summary.status = "active";
  summary.comparisons = results
    .filter((r) => r.shockStatus === "interpolated")
    .map((r) => ({
      id: r.id,
      peakAccelerationG: r.peakAccelerationG,
      marginG: summary.criticalG - r.peakAccelerationG,
      ratio: r.peakAccelerationG / summary.criticalG,
      belowFragility: r.peakAccelerationG < summary.criticalG,
    }));
  return { summary, warnings };
}

// ---------------------------------------------------------------------------
// Export record
// ---------------------------------------------------------------------------

/**
 * Build the exportable record: calculator ID, engine version, inputs, units,
 * assumptions, data-source versions, warnings and results (full precision).
 */
export function buildExportRecord(input, output, generatedAt = new Date().toISOString()) {
  const curve = input?.curve ?? null;
  return {
    calculatorId: CALCULATOR_ID,
    engineVersion: ENGINE_VERSION,
    specVersion: SPEC_VERSION,
    generatedAt,
    units: {
      mass: "kg",
      staticPressure: "Pa",
      bearingArea: "m²",
      peakAcceleration: "g (multiples of 9.80665 m/s²)",
      length: "m",
      note: "Inputs are recorded as entered, with their units. Results are SI at full precision.",
    },
    inputs: structuredCloneSafe(input),
    dataSources: curve
      ? [
          {
            datasetId: curve.datasetId ?? "",
            datasetVersion: curve.datasetVersion ?? "",
            dataType: curve.dataType ?? "",
            source: curve.source ?? "",
            testMethod: curve.testMethod ?? "",
            materialEvidence: curve.dataType !== "synthetic",
          },
        ]
      : [],
    assumptions: output.assumptions,
    shock: output.shock,
    results: output.configurations.map((c) => ({
      id: c.id,
      label: c.label,
      mode: c.mode,
      status: c.status,
      staticPressurePa: c.staticPressurePa,
      bearingAreaM2: c.bearingAreaM2,
      peakAccelerationG: c.peakAccelerationG,
      shockStatus: c.shockStatus,
      messages: c.messages.map((m) => m.text),
    })),
    candidate: output.candidate,
    fragility: output.fragility,
    warnings: [...output.errors, ...output.warnings, ...(output.curve?.errors ?? [])].map((m) => m.text),
    disclaimer:
      "Engineering decision support only. Results depend on the applicability of the cushion-curve data entered. Not a shipping qualification and not a claim of conformance to any standard.",
  };
}

function structuredCloneSafe(obj) {
  return obj === undefined ? null : JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Formatting used inside messages (display only; never fed back into calculations)
// ---------------------------------------------------------------------------

function msg(code, text, field) {
  return field ? { code, text, field } : { code, text };
}

export function fmtPa(pa) {
  if (!isFiniteNumber(pa)) return "—";
  if (pa >= 1000) return `${trimNum(pa / 1000, 4)} kPa`;
  return `${trimNum(pa, 4)} Pa`;
}

function fmtLen(m) {
  if (m >= 1) return `${trimNum(m, 4)} m`;
  return `${trimNum(m * 1000, 4)} mm`;
}

/** Format with a given number of significant figures, without trailing zeros. */
export function trimNum(x, sig = 4) {
  if (!isFiniteNumber(x)) return "—";
  if (x === 0) return "0";
  const s = Number(x.toPrecision(sig));
  return String(s);
}
