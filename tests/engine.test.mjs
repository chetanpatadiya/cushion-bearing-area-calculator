// Verification tests for the EP01 calculation engine.
// Run with: npm test   (Node 20+; uses the built-in node:test runner)
//
// Test IDs (VC-xx) are referenced in docs/verification-record.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

import {
  STANDARD_GRAVITY,
  ENGINE_VERSION,
  CALCULATOR_ID,
  staticPressure,
  requiredArea,
  validateCurve,
  interpolatePeakAcceleration,
  parseCurveCsv,
  evaluate,
  buildExportRecord,
  AREA_UNITS,
  PRESSURE_UNITS,
  toSI,
} from "../public/assets/engine.js";

const REL_TOL = 1e-4; // 0.01 % relative tolerance (charter)

function assertRel(actual, expected, tol = REL_TOL, label = "") {
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(rel <= tol, `${label} expected ${expected}, got ${actual} (relative error ${rel.toExponential(3)} > ${tol})`);
}

/** Synthetic verification curve from the charter. Never material evidence. */
function syntheticCurve(overrides = {}) {
  return {
    datasetId: "SYN-EP01-VERIFY",
    datasetVersion: "1.0.0",
    dataType: "synthetic",
    material: "Synthetic verification data",
    thickness: { value: "50", unit: "mm" },
    dropHeight: { value: "762", unit: "mm" },
    source: "EP01 charter acceptance case",
    testMethod: "None — synthetic",
    temperatureC: "23",
    dropSequence: "Not applicable",
    pointPressureUnit: "kPa",
    points: [
      { pressure: "1", accelerationG: "50" },
      { pressure: "3", accelerationG: "30" },
    ],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    scenario: { massKg: "2", dropHeight: { value: "762", unit: "mm" }, orientation: "Flat, bottom face" },
    curve: syntheticCurve(),
    configurations: [{ id: "A", label: "A", mode: "pressure", targetPressure: { value: "2", unit: "kPa" } }],
    fragility: null,
    ...overrides,
  };
}

// --- VC-01 .. VC-04: deterministic equations ------------------------------------

test("VC-01 static pressure at 2 kg on 100 cm² equals 1961.33 Pa", () => {
  const area = toSI(100, "cm2", AREA_UNITS);
  const p = staticPressure(2, area);
  assertRel(p, 1961.33, REL_TOL, "p");
  // Exact value from the definition of g: 2 × 9.80665 / 0.01 = 1961.33
  assert.equal(Number(p.toFixed(6)), 1961.33);
});

test("VC-02 doubling bearing area halves static pressure", () => {
  for (const [m, aCm2] of [[2, 100], [0.35, 12.5], [18, 640], [1e-3, 1]]) {
    const a = toSI(aCm2, "cm2", AREA_UNITS);
    const p1 = staticPressure(m, a);
    const p2 = staticPressure(m, 2 * a);
    assertRel(p2, p1 / 2, REL_TOL, `m=${m} A=${aCm2}`);
  }
});

test("VC-03 required area is the inverse of static pressure", () => {
  for (const [m, pPa] of [[2, 1961.33], [5, 3500], [0.8, 900]]) {
    const A = requiredArea(m, pPa);
    assertRel(staticPressure(m, A), pPa, REL_TOL);
  }
  assertRel(requiredArea(2, 2000), (2 * STANDARD_GRAVITY) / 2000);
});

test("VC-04 unit conversions are exact to definition", () => {
  assert.equal(toSI(100, "cm2", AREA_UNITS), 0.01);
  assert.equal(toSI(10000, "mm2", AREA_UNITS), 0.01);
  assertRel(toSI(1, "psi", PRESSURE_UNITS), 6894.757293168361, 1e-12);
  assert.equal(toSI(2, "kPa", PRESSURE_UNITS), 2000);
});

// --- VC-05 .. VC-07: interpolation --------------------------------------------------

test("VC-05 synthetic points (1 kPa, 50 g) and (3 kPa, 30 g) interpolate to 40 g at 2 kPa", () => {
  const check = validateCurve(syntheticCurve());
  assert.equal(check.usable, true);
  const r = interpolatePeakAcceleration(check.pointsSI, 2000);
  assert.equal(r.status, "ok");
  assertRel(r.accelerationG, 40);
});

test("VC-06 interpolation returns exact endpoint values and uses adjacent points only", () => {
  const check = validateCurve(
    syntheticCurve({
      points: [
        { pressure: "1", accelerationG: "50" },
        { pressure: "2", accelerationG: "36" },
        { pressure: "4", accelerationG: "44" },
      ],
    }),
  );
  const pts = check.pointsSI;
  assert.equal(interpolatePeakAcceleration(pts, 1000).accelerationG, 50);
  assert.equal(interpolatePeakAcceleration(pts, 4000).accelerationG, 44);
  // 3 kPa lies between (2, 36) and (4, 44): 40 g. A global fit would differ.
  const mid = interpolatePeakAcceleration(pts, 3000);
  assert.deepEqual(mid.segment, [1, 2]);
  assertRel(mid.accelerationG, 40);
});

test("VC-07 unsorted points are sorted before interpolation and flagged", () => {
  const check = validateCurve(
    syntheticCurve({ points: [{ pressure: "3", accelerationG: "30" }, { pressure: "1", accelerationG: "50" }] }),
  );
  assert.equal(check.usable, true);
  assert.ok(check.warnings.some((w) => w.code === "points-reordered"));
  assertRel(interpolatePeakAcceleration(check.pointsSI, 2000).accelerationG, 40);
});

// --- VC-08 .. VC-12: rejection rules --------------------------------------------------

test("VC-08 duplicate pressure points are rejected", () => {
  const check = validateCurve(
    syntheticCurve({
      points: [
        { pressure: "1", accelerationG: "50" },
        { pressure: "1.0", accelerationG: "48" },
        { pressure: "3", accelerationG: "30" },
      ],
    }),
  );
  assert.equal(check.usable, false);
  assert.ok(check.errors.some((e) => e.code === "points-duplicate"));
});

test("VC-09 missing curve metadata is rejected, field by field", () => {
  const fields = ["datasetId", "datasetVersion", "material", "source", "testMethod", "dropSequence"];
  for (const f of fields) {
    const check = validateCurve(syntheticCurve({ [f]: "  " }));
    assert.equal(check.usable, false, `${f} blank should reject`);
    assert.ok(check.errors.some((e) => e.code === "metadata-missing" && e.field === f), f);
  }
  for (const [f, v] of [["thickness", { value: "", unit: "mm" }], ["dropHeight", { value: "0", unit: "mm" }], ["temperatureC", ""], ["dataType", "material-preset"]]) {
    const check = validateCurve(syntheticCurve({ [f]: v }));
    assert.equal(check.usable, false, `${f} invalid should reject`);
  }
});

test("VC-10 nonpositive or non-numeric area and mass are rejected", () => {
  for (const bad of [0, -1, NaN, Infinity, "10"]) {
    assert.throws(() => staticPressure(2, bad), { code: "area" });
    assert.throws(() => staticPressure(bad, 0.01), { code: "mass" });
  }
  const out = evaluate(baseInput({ configurations: [{ id: "A", mode: "area", area: { value: "0", unit: "cm2" } }] }));
  assert.equal(out.configurations[0].status, "error");
  assert.equal(out.configurations[0].staticPressurePa, null);
  const outNeg = evaluate(baseInput({ configurations: [{ id: "A", mode: "area", area: { value: "-5", unit: "cm2" } }] }));
  assert.equal(outNeg.configurations[0].status, "error");
});

test("VC-11 extrapolation requests are refused above and below the data", () => {
  const check = validateCurve(syntheticCurve());
  assert.equal(interpolatePeakAcceleration(check.pointsSI, 999.999).status, "below-range");
  assert.equal(interpolatePeakAcceleration(check.pointsSI, 3000.001).status, "above-range");
  const out = evaluate(
    baseInput({
      configurations: [
        { id: "A", mode: "pressure", targetPressure: { value: "0.5", unit: "kPa" } },
        { id: "B", mode: "pressure", targetPressure: { value: "5", unit: "kPa" } },
      ],
    }),
  );
  for (const c of out.configurations) {
    assert.equal(c.shockStatus, "out-of-range");
    assert.equal(c.peakAccelerationG, null);
    assert.ok(c.messages.some((m) => m.code === "extrapolation"));
  }
});

test("VC-12 curves with fewer than two points, or non-positive values, are rejected", () => {
  assert.equal(validateCurve(syntheticCurve({ points: [{ pressure: "1", accelerationG: "50" }] })).usable, false);
  // Fully blank rows are ignored and do not count as points
  assert.equal(validateCurve(syntheticCurve({ points: [{ pressure: "1", accelerationG: "50" }, { pressure: "", accelerationG: "" }] })).usable, false);
  const gappy = validateCurve(syntheticCurve({ points: [{ pressure: "1", accelerationG: "50" }, { pressure: " ", accelerationG: "" }, { pressure: "3", accelerationG: "30" }] }));
  assert.equal(gappy.usable, true);
  // A half-filled row is reported with its table row number
  const half = validateCurve(syntheticCurve({ points: [{ pressure: "1", accelerationG: "50" }, { pressure: "", accelerationG: "" }, { pressure: "3", accelerationG: "" }, { pressure: "4", accelerationG: "28" }] }));
  assert.ok(half.errors.some((e) => e.field === "points.2.accelerationG" && /Point 3/.test(e.text)));
  assert.equal(validateCurve(syntheticCurve({ points: [{ pressure: "0", accelerationG: "50" }, { pressure: "3", accelerationG: "30" }] })).usable, false);
  assert.equal(validateCurve(syntheticCurve({ points: [{ pressure: "1", accelerationG: "-5" }, { pressure: "3", accelerationG: "30" }] })).usable, false);
});

// --- VC-13 .. VC-16: applicability and evidence labelling ----------------------------

test("VC-13 synthetic data is always labelled and never counted as material evidence", () => {
  const input = baseInput();
  const out = evaluate(input);
  assert.equal(out.curve.synthetic, true);
  assert.ok(out.warnings.some((w) => w.code === "synthetic"));
  const rec = buildExportRecord(input, out, "2026-11-01T00:00:00.000Z");
  assert.equal(rec.dataSources[0].materialEvidence, false);
  assert.ok(rec.warnings.some((w) => /not material evidence/.test(w)));
  // Supplier data without recorded use rights is flagged (charter: release evidence)
  const supplier = validateCurve(syntheticCurve({ dataType: "measured-supplier" }));
  assert.ok(supplier.warnings.some((w) => w.code === "use-rights"));
  const supplierOk = validateCurve(syntheticCurve({ dataType: "measured-supplier", useRights: "Licence ref 123" }));
  assert.ok(!supplierOk.warnings.some((w) => w.code === "use-rights"));
});

test("VC-14 a drop-height mismatch disables shock prediction; static results remain", () => {
  const out = evaluate(baseInput({ scenario: { massKg: "2", dropHeight: { value: "610", unit: "mm" }, orientation: "Flat" } }));
  assert.equal(out.shock.enabled, false);
  assert.equal(out.shock.reason, "drop-height-mismatch");
  assert.equal(out.configurations[0].shockStatus, "disabled");
  assert.ok(out.configurations[0].staticPressurePa > 0);
  // 30 in is the same drop as 762 mm within tolerance
  const same = evaluate(baseInput({ scenario: { massKg: "2", dropHeight: { value: "30", unit: "in" }, orientation: "Flat" } }));
  assert.equal(same.shock.enabled, true);
});

test("VC-15 with no curve, only static-loading results are produced", () => {
  const out = evaluate(baseInput({ curve: null, configurations: [{ id: "A", mode: "area", area: { value: "100", unit: "cm2" } }] }));
  assert.equal(out.shock.enabled, false);
  assert.equal(out.shock.reason, "no-curve");
  assertRel(out.configurations[0].staticPressurePa, 1961.33);
  assert.equal(out.configurations[0].peakAccelerationG, null);
  assert.equal(out.candidate, null);
});

test("VC-16 fragility comparison appears only with full pulse context and confirmation", () => {
  const fragility = { enabled: true, criticalG: "45", pulseShape: "Half-sine", pulseDurationMs: "3", velocityChangeMps: "", method: "ASTM D3332 Method B", conditionsConfirmed: false };
  let out = evaluate(baseInput({ fragility }));
  assert.equal(out.fragility.status, "unconfirmed");
  assert.equal(out.fragility.comparisons.length, 0);

  out = evaluate(baseInput({ fragility: { ...fragility, pulseDurationMs: "" , conditionsConfirmed: true } }));
  assert.equal(out.fragility.status, "incomplete");

  out = evaluate(baseInput({ fragility: { ...fragility, conditionsConfirmed: true } }));
  assert.equal(out.fragility.status, "active");
  assert.equal(out.fragility.comparisons.length, 1);
  assertRel(out.fragility.comparisons[0].marginG, 5);
  assert.match(out.fragility.note, /not a shipping qualification/);
});

// --- VC-17 .. VC-19: CSV, precision, export --------------------------------------------

test("VC-17 CSV import accepts a header row and comma, semicolon or tab separators", () => {
  const r = parseCurveCsv("static pressure (kPa),peak g\n1,50\n3;30\n\n2\t40\n");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.points, [
    { pressure: 1, accelerationG: 50 },
    { pressure: 3, accelerationG: 30 },
    { pressure: 2, accelerationG: 40 },
  ]);
  const bad = parseCurveCsv("1,50\nabc,def\n");
  assert.equal(bad.errors.length, 1);
  assert.equal(parseCurveCsv("").errors[0].code, "csv-empty");
  assert.equal(parseCurveCsv("1,2,3").errors.length, 1);
});

test("VC-18 results keep full precision internally (rounding is display-only)", () => {
  const out = evaluate(baseInput({ configurations: [{ id: "A", mode: "area", area: { value: "97", unit: "cm2" } }] }));
  const expected = (2 * STANDARD_GRAVITY) / 0.0097;
  assert.equal(out.configurations[0].staticPressurePa, expected);
});

test("VC-19 export record carries ID, versions, inputs, units, assumptions, sources and warnings, and matches the schema", () => {
  const input = baseInput();
  const out = evaluate(input);
  const rec = buildExportRecord(input, out, "2026-11-01T00:00:00.000Z");
  assert.equal(rec.calculatorId, CALCULATOR_ID);
  assert.equal(rec.engineVersion, ENGINE_VERSION);
  for (const k of ["inputs", "units", "assumptions", "dataSources", "warnings", "results"]) assert.ok(k in rec, k);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const outputSchema = JSON.parse(readFileSync(new URL("../public/schema/output.schema.json", import.meta.url)));
  const inputSchema = JSON.parse(readFileSync(new URL("../public/schema/input.schema.json", import.meta.url)));
  const validOut = ajv.validate(outputSchema, rec);
  assert.ok(validOut, JSON.stringify(ajv.errors, null, 2));
  const validIn = ajv.validate(inputSchema, input);
  assert.ok(validIn, JSON.stringify(ajv.errors, null, 2));
});

test("VC-20 worked examples in examples/ reproduce their recorded results", () => {
  const examples = JSON.parse(readFileSync(new URL("../public/examples/worked-examples.json", import.meta.url)));
  assert.ok(examples.length >= 3);
  for (const ex of examples) {
    const out = evaluate(ex.input);
    ex.expected.forEach((exp, i) => {
      const got = out.configurations[i];
      if (exp.staticPressurePa !== undefined) assertRel(got.staticPressurePa, exp.staticPressurePa, REL_TOL, `${ex.id} p`);
      if (exp.bearingAreaM2 !== undefined) assertRel(got.bearingAreaM2, exp.bearingAreaM2, REL_TOL, `${ex.id} A`);
      if (exp.peakAccelerationG !== undefined) {
        if (exp.peakAccelerationG === null) assert.equal(got.peakAccelerationG, null, `${ex.id} g`);
        else assertRel(got.peakAccelerationG, exp.peakAccelerationG, REL_TOL, `${ex.id} g`);
      }
      if (exp.shockStatus) assert.equal(got.shockStatus, exp.shockStatus, `${ex.id} shock`);
    });
  }
});
