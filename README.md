# Cushion Bearing Area and Shock Response Calculator (EP01)

A browser calculator for packaging, mechanical, reliability and test engineers. For one shipping scenario it gives:

- static pressure on the cushion, p = m·g / A (g = 9.80665 m/s²)
- the bearing area needed for a target static pressure, A = m·g / p
- transmitted peak acceleration, read from **your own measured cushion curve** by straight-line interpolation between adjacent points
- a side-by-side comparison of up to three configurations, with a plot, an applicability record and an exportable result

It never extrapolates outside the curve data, never interpolates across thicknesses or drop heights, has no material presets and does not estimate shock from foam density. A product-fragility comparison is available only with compatible pulse conditions and is not a shipping qualification.

Built from the EP01 Project Charter v0.1 (1 November 2026). Product owner: Chetan Patadiya.

## Layout

```
public/                      Deployable site (static files, no build step)
  index.html                 Calculator
  methodology.html           Equations, rules, worked examples, references
  assets/engine.js           Calculation engine (pure functions, shared with the tests)
  assets/plot.js             SVG plot
  assets/app.js              Interface
  assets/styles.css          Styles
  assets/fonts/              Barlow (SIL Open Font License, see OFL.txt)
  schema/                    Input and export JSON Schemas
  examples/                  Worked examples (re-run by the tests)
docs/
  calculation-spec.md        Versioned calculation specification
  verification-record.md     Verification results
tests/engine.test.mjs        Automated verification (node:test)
wrangler.toml                Cloudflare Pages settings
```

## Run locally

```
npm install      # installs the schema validator used by the tests
npm test         # 20 verification checks
npm run serve    # serves public/ at http://localhost:4173
```

Any static file server works; the page uses ES modules, so open it over http rather than as a file.

## Deploy

Live at **https://chetanpatadiya.com/cushion-bearing-area-calculator/** and listed under Featured Engineering Tools on https://chetanpatadiya.com.

Deployment is automatic. `.github/workflows/pages.yml` runs the verification tests on every push and pull request; on `main` it publishes `public/` to GitHub Pages only if every test passes. In the repository's Settings → Pages, the source must be **GitHub Actions**.

The `public/` folder is the whole site and uses relative paths only, so it also works at a domain root or under another sub-path (the charter proposed `/calculators/cushion-bearing-area/`; this deployment follows the site's existing one-path-per-tool convention instead). Cloudflare Pages is an alternative:

```
npx wrangler pages deploy public --project-name cushion-bearing-area-calculator
```

Nothing is sent anywhere. Inputs stay in the browser (remembered in local storage on that device only) and exports are generated locally.

## Versioning

- Engine and specification share a semantic version (`ENGINE_VERSION` in `engine.js`, header of `docs/calculation-spec.md`). Any change to equations, rules or tolerances bumps at least the minor version and re-runs the verification.
- Curve datasets are versioned separately by the user (dataset ID and version are required fields) and recorded in every export.

## Status

Planning release 0.1. Verified against the charter's acceptance cases (see `docs/verification-record.md`). Independent technical review is pending. No experimental validation is claimed.

## References

- ASTM D1596, dynamic shock cushioning characteristics: https://store.astm.org/d1596-14r21.html
- ASTM D3332, mechanical-shock fragility: https://store.astm.org/standards/d3332
- Pregis, using measured cushion curves: https://www.pregis.com/knowledge-hub/how-cushion-curves-enable-smarter-packaging-decisions/

Confirm applicable editions before implementing any standard-specific workflow. This calculator claims no conformance to any standard.
