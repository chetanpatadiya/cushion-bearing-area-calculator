# Calculation specification — EP01 Cushion Bearing Area and Shock Response Calculator

| Item | Value |
|---|---|
| Calculator ID | `ep01-cushion-bearing-area` |
| Specification version | 0.1.0 |
| Engine version implementing it | 0.1.0 (`public/assets/engine.js`) |
| Governing charter | EP01 Project Charter v0.1, 1 November 2026 |
| Product owner | Chetan Patadiya |
| Technical reviewer | To be assigned (charter milestone M1) |
| Status | Draft for technical review. No experimental validation is claimed. |

## 1. Purpose

Determine candidate cushion bearing areas and compare the transmitted peak acceleration of up to three configurations, using measured cushion-curve points for one defined shipping scenario.

## 2. Quantities and units

| Quantity | Symbol | Internal unit | Accepted input units |
|---|---|---|---|
| Supported mass | m | kg | kg |
| Bearing area | A | m² | mm², cm², m² |
| Static pressure (static stress) | p | Pa | Pa, kPa, psi |
| Peak transmitted acceleration | G | g (multiples of g₀) | g |
| Drop height, cushion thickness | h, t | m | mm, cm, m, in |
| Temperature | T | °C | °C |

Constants and conversion factors (exact by definition):

- g₀ = 9.80665 m/s²
- 1 cm² = 1 × 10⁻⁴ m²; 1 mm² = 1 × 10⁻⁶ m²
- 1 kPa = 1000 Pa; 1 psi = 6894.757293168361 Pa
- 1 in = 0.0254 m

## 3. Equations

**E1 — Static pressure**

  p = m · g₀ / A

**E2 — Required bearing area for a target static pressure**

  A = m · g₀ / p

Both require m > 0 and A > 0 (or p > 0), finite. Otherwise the input is rejected with a message; no result is shown.

**E3 — Transmitted peak acceleration (piecewise linear interpolation)**

Given measured curve points (pᵢ, Gᵢ), i = 1…n, sorted so that p₁ < p₂ < … < pₙ, and an operating static pressure p:

- If p < p₁ or p > pₙ: no value. The request is an extrapolation and is refused.
- If p = pᵢ: G = Gᵢ.
- If pᵢ < p < pᵢ₊₁: G = Gᵢ + (p − pᵢ) · (Gᵢ₊₁ − Gᵢ) / (pᵢ₊₁ − pᵢ)

Only the two adjacent points bracketing p are used. No curve fitting, smoothing, density-based model or material preset is used.

**E4 — Candidate operating point from data**

The measured point with the lowest Gᵢ is reported with the bearing area that places the load at that pressure (E2). If that point is the first or last point of the curve, a warning states that a lower value may lie outside the data and that the tool does not extrapolate to look for it.

## 4. Applicability rules

| Rule | Behaviour |
|---|---|
| R1 One curve per evaluation, for a fixed material, thickness and drop condition | V0.1 accepts one curve. No interpolation across thicknesses or drop heights. |
| R2 Curve metadata must be complete | Dataset ID, dataset version, data type, material, thickness, test drop height, source, test method, temperature and drop sequence are required. If any is missing, shock prediction is disabled; static results remain. |
| R3 At least two points; all pressures and accelerations positive and finite | Otherwise the curve is rejected. |
| R4 No duplicate pressures | Two points whose pressures differ by no more than 1 × 10⁻⁹ relative are rejected as duplicates. |
| R5 Unsorted points | Sorted ascending by pressure before use, with a notice. |
| R6 Drop height must match | The scenario drop height must equal the curve's test drop height within 1 % relative (allows unit conversion such as 30 in vs 762 mm). Otherwise shock prediction is disabled. |
| R7 No extrapolation | Operating pressures outside [p₁, pₙ] report no peak acceleration and say why. |
| R8 Synthetic data | Curves with data type "synthetic" are labelled on screen and in exports as verification data, not material evidence. `materialEvidence` is always `false` for them. |
| R9 No curve | Static-loading results only. Shock prediction is disabled. |
| R10 Fragility comparison | Shown only when a positive fragility value, pulse shape, pulse duration and method are entered **and** the user confirms that the pulse conditions are compatible with the cushion test conditions. Always labelled as not a shipping qualification. |

## 5. Numerical handling

- All calculations use IEEE 754 double precision at full precision. Rounding is applied only when values are displayed.
- Deterministic equation checks meet 0.01 % relative tolerance (charter).
- Numeric input accepts plain decimals and exponent notation (for example `0.5`, `1.2e3`). Thousands separators and units typed into number fields are rejected rather than guessed.

## 6. Outputs

Per configuration: static pressure, bearing area, interpolated peak acceleration (or the reason none is given), and the status of the shock prediction. Overall: the candidate operating point (E4), applicability record (curve metadata and checks), warnings, and the conditional fragility comparison.

The export record (`public/schema/output.schema.json`) carries: calculator ID, engine and specification versions, timestamp, units, inputs exactly as entered, data-source IDs and versions, assumptions, results at full precision, and all warnings.

## 7. Exclusions (charter)

- Invented or default material presets
- Peak-acceleration predictions from foam density alone
- Automatic foam selection
- Universal fragility ratings for any product class
- Claims of conformance to any standard; the tool is not a shipping qualification

## 8. Versioning

- The engine version follows semantic versioning. Any change to equations, rules or tolerances increments at least the minor version and requires the verification tests to be updated and re-run.
- Curve datasets carry their own dataset ID and version, independent of the engine.
- This specification's version matches the engine version that implements it.

## 9. References used for scoping

Public summaries are not substitutes for the complete standards. Confirm the applicable editions before implementing any standard-specific workflow.

- ASTM D1596, Standard Test Method for Dynamic Shock Cushioning Characteristics of Packaging Material — https://store.astm.org/d1596-14r21.html
- ASTM D3332, Standard Test Methods for Mechanical-Shock Fragility of Products, Using Shock Machines — https://store.astm.org/standards/d3332
- Pregis, guidance on using measured cushion curves — https://www.pregis.com/knowledge-hub/how-cushion-curves-enable-smarter-packaging-decisions/
