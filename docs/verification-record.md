# Verification record — EP01 Cushion Bearing Area Calculator

| Item | Value |
|---|---|
| Calculator ID | `ep01-cushion-bearing-area` |
| Engine version / specification | 0.1.0 / 0.1.0 |
| Record date | 1 November 2026 |
| Prepared by | Implementation draft, for review by the technical reviewer (to be assigned) |
| Automated test environment | Node.js 22.23.4, built-in `node:test` runner; JSON Schema validation with Ajv 8 |
| Browser check environment | Google Chrome 153 (headless), desktop 1440 × 1100 and phone 390 × 844 viewports |
| Re-run | `npm install` then `npm test` |

Scope: this record verifies that the software implements `docs/calculation-spec.md`. It is not experimental validation of any cushion material, and no material data is used anywhere in it. All curve data below are synthetic and labelled as such.

## 1. Engine verification (automated)

Tolerance for deterministic equation checks: 0.01 % relative (charter).

| ID | Check | Charter link | Result |
|---|---|---|---|
| VC-01 | 2 kg on 100 cm² gives 1961.33 Pa | Acceptance case | Pass |
| VC-02 | Doubling bearing area halves static pressure (four mass/area pairs) | Acceptance case | Pass |
| VC-03 | Required area is the exact inverse of static pressure | Calculation basis | Pass |
| VC-04 | Unit conversions (cm², mm², kPa, psi) exact to definition | Inputs and units | Pass |
| VC-05 | Synthetic (1 kPa, 50 g), (3 kPa, 30 g) interpolate to 40 g at 2 kPa | Acceptance case | Pass |
| VC-06 | Endpoints return measured values; only the adjacent bracketing pair is used | First release scope | Pass |
| VC-07 | Unsorted points are sorted and flagged | First release scope | Pass |
| VC-08 | Duplicate pressure points rejected | Acceptance case | Pass |
| VC-09 | Missing metadata rejected, field by field (10 fields) | Acceptance case | Pass |
| VC-10 | Zero, negative, non-finite and non-numeric area and mass rejected | Acceptance case | Pass |
| VC-11 | Extrapolation refused above and below the data | Acceptance case | Pass |
| VC-12 | Fewer than two points or non-positive values rejected; blank rows ignored; partial rows reported by table row | Invalid-input handling | Pass |
| VC-13 | Synthetic data labelled and never recorded as material evidence; supplier data without use rights flagged | Acceptance case; release evidence | Pass |
| VC-14 | Drop-height mismatch disables shock prediction, static results remain; 30 in matches 762 mm | Boundaries | Pass |
| VC-15 | No curve gives static-loading results only | Release evidence | Pass |
| VC-16 | Fragility comparison only with full pulse context and confirmation; labelled not a shipping qualification | Outputs | Pass |
| VC-17 | CSV import: optional header, comma/semicolon/tab, malformed rows reported | First release scope | Pass |
| VC-18 | Results held at full precision (rounding display-only) | Acceptance case | Pass |
| VC-19 | Export record carries ID, versions, inputs, units, assumptions, sources, warnings; validates against `output.schema.json`; input validates against `input.schema.json` | Architecture | Pass |
| VC-20 | All worked examples in `public/examples/worked-examples.json` reproduce their recorded results | Deliverables | Pass |

Summary: 20 of 20 pass.

## 2. Interface checks (browser)

Run against the served `public/` folder in headless Chrome. Inputs typed through the interface, outputs read from the page.

| ID | Check | Observed | Result |
|---|---|---|---|
| UI-01 | Default 2 kg on 100 cm² | 1.961 kPa, 1961.33 Pa | Pass |
| UI-02 | Synthetic curve at 2 kPa target | Bearing area 98.07 cm² (9806.65 mm², required), 40.0 g | Pass |
| UI-03 | Three areas 80 / 150 / 300 cm² on synthetic curve | 35.5 g, 46.9 g, "Outside curve data" with explanation; matches WE-03 | Pass |
| UI-04 | Add configuration disabled at three | Disabled | Pass |
| UI-05 | Fragility 45 g, half-sine 3 ms, method entered | Hidden until confirmation box ticked; then 9.5 g below (A), 1.9 g at or above (B) | Pass |
| UI-06 | Scenario drop 610 mm against 762 mm curve | Shock prediction disabled with reason; 30 in re-enables it | Pass |
| UI-07 | Mass 0 and "abc" | Field error shown, field marked invalid | Pass |
| UI-08 | Area −5 cm² | Configuration shows "Check input" and the reason | Pass |
| UI-09 | Duplicate pressure point | Curve rejected, rows named, shock prediction disabled | Pass |
| UI-10 | Curve source cleared | "Curve source is required", field marked invalid | Pass |
| UI-11 | CSV import, unsorted with header | 3 points imported, sort notice shown | Pass |
| UI-12 | CSV with a non-numeric row | Nothing imported, line named | Pass |
| UI-13 | Export JSON | File downloaded; values identical to engine at full precision; `materialEvidence: false` for synthetic | Pass |
| UI-14 | Print summary | Results, plot, record, warnings, assumptions, versions and disclaimer on the printout | Pass |
| UI-15 | Phone width 390 px | No horizontal page scroll; compact plot keeps labels legible; results table scrolls inside its panel | Pass |
| UI-16 | Keyboard | All controls reachable by Tab in reading order; visible focus ring; entry mode switch works with arrow keys | Pass |
| UI-17 | Dark colour scheme | All text and plot elements legible | Pass |
| UI-18 | Console | No errors or warnings during the runs above | Pass |
| UI-19 | Input persistence | Inputs restored after reload (stored only in the user's own browser) | Pass |

## 3. Open items before release (charter)

- Independent technical review (reviewer not yet assigned).
- Screen-reader pass with NVDA or VoiceOver, and a check on a physical phone.
- Any release using supplier curves needs provenance, use rights and a review of test conditions for that dataset.
- Confirm the applicable editions of ASTM D1596 and D3332 before adding any standard-specific workflow.

## 4. Configuration identification

| File | Role |
|---|---|
| `public/assets/engine.js` | Calculation engine (SHA-256 prefix at record time: `d7459cba414be804`) |
| `tests/engine.test.mjs` | Automated verification (VC-01 to VC-20) |
| `public/schema/*.json` | Input and export schemas |
| `public/examples/worked-examples.json` | Worked examples re-run by VC-20 |
