// SVG plot of the cushion curve and the configurations' operating points.
// Display only: every number drawn comes from the engine output.

// Two layouts: wide (desktop) and compact (phones), so text stays legible after scaling.
const LAYOUTS = {
  wide: { W: 680, H: 420, M: { l: 60, r: 22, t: 20, b: 54 }, fs: 1 },
  compact: { W: 400, H: 340, M: { l: 48, r: 12, t: 16, b: 50 }, fs: 1.05 },
};

const SHAPES = { A: "circle", B: "square", C: "triangle" };
let uid = 0;

export function markerShape(id) {
  return SHAPES[id] ?? "circle";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function niceStep(span, target = 5) {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return step * mag;
}

function tickLabel(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(decimals);
}

function markerPath(shape, x, y, r = 6.5) {
  if (shape === "square") return `<rect x="${x - r * 0.88}" y="${y - r * 0.88}" width="${r * 1.76}" height="${r * 1.76}"`;
  if (shape === "triangle") return `<path d="M${x} ${y - r * 1.1} L${x + r} ${y + r * 0.75} L${x - r} ${y + r * 0.75} Z"`;
  return `<circle cx="${x}" cy="${y}" r="${r}"`;
}

/**
 * opts = {
 *   unit: { key, label, toSI },          // display unit for pressure axis
 *   curvePoints: [{pressurePa, accelerationG}] | null,
 *   shockEnabled: boolean,
 *   synthetic: boolean,
 *   configs: [{ id, staticPressurePa, peakAccelerationG, shockStatus }],
 *   fragilityG: number | null,
 * }
 * Returns { svg, description }.
 */
export function renderPlot(opts) {
  const L = opts.compact ? LAYOUTS.compact : LAYOUTS.wide;
  const { W, H, M } = L;
  const PW = W - M.l - M.r;
  const PH = H - M.t - M.b;
  const f = (n) => (n * L.fs).toFixed(1);
  const id = `p${++uid}`;
  const u = opts.unit;
  const toU = (pa) => pa / u.toSI;
  const pts = opts.curvePoints && opts.curvePoints.length >= 2 ? opts.curvePoints : null;
  const cfgs = (opts.configs || []).filter((c) => Number.isFinite(c.staticPressurePa));

  // Domain
  let xMaxRaw = 0;
  if (pts) xMaxRaw = Math.max(xMaxRaw, toU(pts[pts.length - 1].pressurePa));
  for (const c of cfgs) xMaxRaw = Math.max(xMaxRaw, toU(c.staticPressurePa));
  if (xMaxRaw <= 0) xMaxRaw = u.key === "Pa" ? 5000 : u.key === "psi" ? 1 : 5;
  const xStep = niceStep(xMaxRaw * 1.08, opts.compact ? 4 : 5);
  const xMax = Math.ceil((xMaxRaw * 1.08) / xStep) * xStep;

  let yMaxRaw = 0;
  if (pts) for (const p of pts) yMaxRaw = Math.max(yMaxRaw, p.accelerationG);
  if (opts.fragilityG) yMaxRaw = Math.max(yMaxRaw, opts.fragilityG);
  const hasY = pts !== null;
  if (yMaxRaw <= 0) yMaxRaw = 100;
  const yStep = niceStep(yMaxRaw * 1.12, opts.compact ? 4 : 5);
  const yMax = Math.ceil((yMaxRaw * 1.12) / yStep) * yStep;

  const sx = (v) => M.l + (v / xMax) * PW;
  const sy = (g) => M.t + PH - (g / yMax) * PH;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${id}-title ${id}-desc" font-family="Barlow, system-ui, sans-serif">`);
  parts.push(`<title id="${id}-title">Cushion curve with operating points</title>`);

  parts.push(`<defs>
    <pattern id="${id}-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" fill="var(--sheet)"/>
      <line x1="0" y1="0" x2="0" y2="8" stroke="var(--hatch)" stroke-width="2" stroke-opacity="0.45"/>
    </pattern>
    <clipPath id="${id}-clip"><rect x="${M.l}" y="${M.t}" width="${PW}" height="${PH}"/></clipPath>
  </defs>`);

  // Graph paper
  parts.push(`<rect x="${M.l}" y="${M.t}" width="${PW}" height="${PH}" fill="var(--sheet)"/>`);
  const xMinor = xStep / (Math.abs((xStep / Math.pow(10, Math.floor(Math.log10(xStep)))) - 2) < 1e-9 ? 4 : 5);
  const yMinor = yStep / (Math.abs((yStep / Math.pow(10, Math.floor(Math.log10(yStep)))) - 2) < 1e-9 ? 4 : 5);
  const grid = [];
  for (let v = xMinor; v < xMax - 1e-9; v += xMinor) grid.push(`<line x1="${sx(v)}" y1="${M.t}" x2="${sx(v)}" y2="${M.t + PH}" stroke="var(--grid-minor)"/>`);
  for (let g = yMinor; g < yMax - 1e-9; g += yMinor) grid.push(`<line x1="${M.l}" y1="${sy(g)}" x2="${M.l + PW}" y2="${sy(g)}" stroke="var(--grid-minor)"/>`);
  for (let v = xStep; v < xMax - 1e-9; v += xStep) grid.push(`<line x1="${sx(v)}" y1="${M.t}" x2="${sx(v)}" y2="${M.t + PH}" stroke="var(--grid-major)"/>`);
  if (hasY) for (let g = yStep; g < yMax - 1e-9; g += yStep) grid.push(`<line x1="${M.l}" y1="${sy(g)}" x2="${M.l + PW}" y2="${sy(g)}" stroke="var(--grid-major)"/>`);
  parts.push(`<g shape-rendering="crispEdges">${grid.join("")}</g>`);

  // No-data zones (outside measured pressure range)
  if (pts) {
    const x0 = sx(toU(pts[0].pressurePa));
    const x1 = sx(toU(pts[pts.length - 1].pressurePa));
    parts.push(`<g clip-path="url(#${id}-clip)">`);
    if (x0 > M.l + 0.5) parts.push(`<rect x="${M.l}" y="${M.t}" width="${x0 - M.l}" height="${PH}" fill="url(#${id}-hatch)"/>`);
    if (x1 < M.l + PW - 0.5) parts.push(`<rect x="${x1}" y="${M.t}" width="${M.l + PW - x1}" height="${PH}" fill="url(#${id}-hatch)"/>`);
    parts.push(`</g>`);
    const rightGap = M.l + PW - x1;
    if (rightGap > (opts.compact ? 58 : 70)) {
      parts.push(`<text x="${x1 + rightGap / 2}" y="${M.t + 18}" text-anchor="middle" font-size="${f(12)}" fill="var(--ink-2)">No data</text>`);
      parts.push(`<text x="${x1 + rightGap / 2}" y="${M.t + 33}" text-anchor="middle" font-size="${f(12)}" fill="var(--ink-2)">not extrapolated</text>`);
    }
  }

  // Synthetic watermark
  if (opts.synthetic && pts) {
    parts.push(`<text x="${M.l + PW / 2}" y="${M.t + PH - 18}" text-anchor="middle" font-size="${f(opts.compact ? 24 : 30)}" font-weight="700" fill="var(--hatch)" fill-opacity="0.35" font-family="'Barlow Semi Condensed', Barlow, sans-serif">Synthetic test data</text>`);
  }

  // Axes
  parts.push(`<line x1="${M.l}" y1="${M.t + PH}" x2="${M.l + PW}" y2="${M.t + PH}" stroke="var(--ink)" stroke-width="1.5"/>`);
  parts.push(`<line x1="${M.l}" y1="${M.t}" x2="${M.l}" y2="${M.t + PH}" stroke="var(--ink)" stroke-width="1.5"/>`);
  for (let v = 0; v <= xMax + 1e-9; v += xStep) {
    parts.push(`<line x1="${sx(v)}" y1="${M.t + PH}" x2="${sx(v)}" y2="${M.t + PH + 5}" stroke="var(--ink)"/>`);
    parts.push(`<text x="${sx(v)}" y="${M.t + PH + 19}" text-anchor="middle" font-size="${f(12.5)}" fill="var(--ink-2)">${tickLabel(v, xStep)}</text>`);
  }
  if (hasY) {
    for (let g = 0; g <= yMax + 1e-9; g += yStep) {
      parts.push(`<line x1="${M.l - 5}" y1="${sy(g)}" x2="${M.l}" y2="${sy(g)}" stroke="var(--ink)"/>`);
      parts.push(`<text x="${M.l - 9}" y="${sy(g) + 4}" text-anchor="end" font-size="${f(12.5)}" fill="var(--ink-2)">${tickLabel(g, yStep)}</text>`);
    }
  }
  parts.push(`<text x="${M.l + PW / 2}" y="${H - 10}" text-anchor="middle" font-size="${f(13.5)}" font-weight="500" fill="var(--ink)">Static pressure (${esc(u.label)})</text>`);
  parts.push(`<text transform="translate(16 ${M.t + PH / 2}) rotate(-90)" text-anchor="middle" font-size="${f(13.5)}" font-weight="500" fill="var(--ink)">Peak acceleration (g)</text>`);

  // Fragility line
  if (opts.fragilityG && hasY) {
    const y = sy(opts.fragilityG);
    parts.push(`<line x1="${M.l}" y1="${y}" x2="${M.l + PW}" y2="${y}" stroke="var(--err)" stroke-width="1.5" stroke-dasharray="7 5"/>`);
    parts.push(`<text x="${M.l + PW - 6}" y="${y - 7}" text-anchor="end" font-size="${f(12.5)}" fill="var(--err)">Fragility ${esc(fmt(opts.fragilityG, 1))} g (conditional)</text>`);
  }

  // Curve
  if (pts) {
    const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(toU(p.pressurePa)).toFixed(2)} ${sy(p.accelerationG).toFixed(2)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.25" stroke-linejoin="round"/>`);
    for (const p of pts) {
      parts.push(`<circle cx="${sx(toU(p.pressurePa))}" cy="${sy(p.accelerationG)}" r="3.5" fill="var(--sheet)" stroke="var(--ink)" stroke-width="2"/>`);
    }
  }

  // Operating points
  const descParts = [];
  const labelSlots = [];
  for (const c of cfgs) {
    const shape = markerShape(c.id);
    const color = `var(--cfg-${c.id.toLowerCase()})`;
    const xv = toU(c.staticPressurePa);
    const x = sx(Math.min(xv, xMax));
    if (c.shockStatus === "interpolated" && hasY) {
      const y = sy(c.peakAccelerationG);
      parts.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${M.t + PH}" stroke="${color}" stroke-width="1.25" stroke-dasharray="4 4"/>`);
      parts.push(`<line x1="${M.l}" y1="${y}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="1.25" stroke-dasharray="4 4"/>`);
      parts.push(`${markerPath(shape, x, y, 7)} fill="${color}" stroke="var(--sheet)" stroke-width="2" class="op-marker"/>`);
      const label = `${c.id}  ${fmt(c.peakAccelerationG, 1)} g`;
      let lx = x + 11;
      let anchor = "start";
      if (lx + 64 > M.l + PW) { lx = x - 11; anchor = "end"; }
      let ly = y - 10;
      while (labelSlots.some((s) => Math.abs(s.y - ly) < 15 && Math.abs(s.x - lx) < 80)) ly -= 16;
      labelSlots.push({ x: lx, y: ly });
      parts.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="${f(13.5)}" font-weight="600" fill="${color}" paint-order="stroke" stroke="var(--sheet)" stroke-width="4">${esc(label)}</text>`);
      descParts.push(`Configuration ${c.id}: ${fmt(c.peakAccelerationG, 1)} g at ${fmt(xv, 3)} ${u.label}.`);
    } else {
      // No peak value: mark the static pressure on the axis only.
      const y = M.t + PH;
      if (c.shockStatus === "out-of-range" && xv <= xMax) {
        parts.push(`<line x1="${x}" y1="${M.t}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="1.25" stroke-dasharray="2 4"/>`);
      }
      parts.push(`${markerPath(shape, x, y, 6.5)} fill="var(--sheet)" stroke="${color}" stroke-width="2.25"/>`);
      let ly = y - 14;
      while (labelSlots.some((s) => Math.abs(s.y - ly) < 15 && Math.abs(s.x - x) < 60)) ly -= 16;
      labelSlots.push({ x, y: ly });
      const note = c.shockStatus === "out-of-range" ? `${c.id} outside data` : c.id;
      const anchor = x > M.l + PW - 80 ? "end" : x < M.l + 40 ? "start" : "middle";
      parts.push(`<text x="${x}" y="${ly}" text-anchor="${anchor}" font-size="${f(13)}" font-weight="600" fill="${color}" paint-order="stroke" stroke="var(--sheet)" stroke-width="4">${esc(note)}</text>`);
      descParts.push(`Configuration ${c.id}: static pressure ${fmt(xv, 3)} ${u.label}${c.shockStatus === "out-of-range" ? ", outside the curve data, no peak acceleration" : ""}.`);
    }
  }

  // Empty-curve invitation
  if (!pts) {
    parts.push(`<text x="${M.l + PW / 2}" y="${M.t + PH / 2 - 10}" text-anchor="middle" font-size="${f(16)}" font-weight="500" fill="var(--ink-2)">Add measured cushion-curve points to plot</text>`);
    parts.push(`<text x="${M.l + PW / 2}" y="${M.t + PH / 2 + 14}" text-anchor="middle" font-size="${f(16)}" font-weight="500" fill="var(--ink-2)">transmitted peak acceleration.</text>`);
    if (cfgs.length) parts.push(`<text x="${M.l + PW / 2}" y="${M.t + PH / 2 + 44}" text-anchor="middle" font-size="${f(13)}" fill="var(--ink-3)">Static pressure of each configuration is marked on the axis.</text>`);
  }

  const description = pts
    ? `Cushion curve with ${pts.length} measured points from ${fmt(toU(pts[0].pressurePa), 3)} to ${fmt(toU(pts[pts.length - 1].pressurePa), 3)} ${u.label}. ${descParts.join(" ")}`
    : `No cushion curve entered. ${descParts.join(" ")}`;
  parts.push(`<desc id="${id}-desc">${esc(description)}</desc>`);
  parts.push(`</svg>`);
  return { svg: parts.join(""), description };
}

function fmt(x, d) {
  return Number.isFinite(x) ? x.toFixed(d) : "—";
}
