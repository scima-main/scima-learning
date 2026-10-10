// Grid canvas — the infinite grid is generated procedurally in SCREEN space:
// every vertex is mapped world→screen in float64 JS and only the visible
// slice is emitted, so all coordinates handed to the context stay
// viewport-sized no matter how far from the origin you pan. (The previous
// version drew under a scaled/rotated world transform; past ~1e6 world px
// the path coordinates exceeded the canvas' float32 precision and the line
// families silently vanished — "the grid stops working far from the origin".)
function spDrawGrid() {
  const ctx = _sp.gridCtx, cv = _sp.gridCanvas;
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv._cssW || 0, cv._cssH || 0);
  const g = _sp.grid;
  if (!g.visible || g.style === 'blank') return;
  const z = _sp.view.zoom, vx = _sp.view.x, vy = _sp.view.y;
  // Thin out spacing when zoomed far out so line count stays bounded (§29).
  let s = Math.max(4, g.spacing);
  while (s * z < 9 && s < 100000) s *= 5;
  const a = g.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const W = cv._cssW || 0, H = cv._cssH || 0;
  // grid-local → screen (local l → world R(a)·l → screen l·z + view)
  const l2s = (lx, ly) => ({ x: vx + z * (lx * ca - ly * sa), y: vy + z * (lx * sa + ly * ca) });
  // screen → grid-local, for the visible bounds
  const s2l = (sx, sy) => {
    const wx = (sx - vx) / z, wy = (sy - vy) / z;
    return { x: wx * ca + wy * sa, y: -wx * sa + wy * ca };
  };
  const cs = [s2l(0, 0), s2l(W, 0), s2l(0, H), s2l(W, H)];
  const mnx = Math.min(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
  const mxx = Math.max(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
  const mny = Math.min(cs[0].y, cs[1].y, cs[2].y, cs[3].y);
  const mxy = Math.max(cs[0].y, cs[1].y, cs[2].y, cs[3].y);
  const op = g.opacity;
  const ink = _sp.gridInk || '255,255,255';
  const faint = `rgba(${ink},${(0.09 * op + 0.03).toFixed(3)})`;
  const mid = `rgba(${ink},${(0.16 * op + 0.05).toFixed(3)})`;
  const strong = `rgba(${ink},${(0.30 * op + 0.08).toFixed(3)})`;

  // One family of parallel lines running along grid-local direction θ,
  // spaced `sp`; `every` thins to every n-th line. Lines are rebased around
  // the family member nearest the viewport centre so path offsets stay small.
  const family = (thetaDeg, sp, color, lw, every) => {
    every = every || 1;
    const t = thetaDeg * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t);
    const nx = -dy, ny = dx;
    const pr = [mnx * nx + mny * ny, mxx * nx + mny * ny, mnx * nx + mxy * ny, mxx * nx + mxy * ny];
    const pmin = Math.min(pr[0], pr[1], pr[2], pr[3]);
    const pmax = Math.max(pr[0], pr[1], pr[2], pr[3]);
    let k0 = Math.ceil(pmin / sp), k1 = Math.floor(pmax / sp);
    if (every > 1) { k0 = Math.ceil(k0 / every) * every; k1 = Math.floor(k1 / every) * every; }
    if (k1 - k0 > 800) return;                                  // perf guard
    const kb = Math.round((pmin + pmax) / 2 / sp / every) * every;
    const B = l2s(nx * kb * sp, ny * kb * sp);                 // anchor, on-screen
    const dsx = z * (dx * ca - dy * sa), dsy = z * (dx * sa + dy * ca);   // screen dir per local unit
    const nsx = z * (nx * ca - ny * sa), nsy = z * (nx * sa + ny * ca);   // screen normal per local unit
    const diag = Math.hypot(mxx - mnx, mxy - mny) + sp * 2;     // local half-length cover
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath();
    for (let k = k0; k <= k1; k += every) {
      const off = (k - kb) * sp;
      const px = B.x + nsx * off, py = B.y + nsy * off;
      ctx.moveTo(px - dsx * diag, py - dsy * diag);
      ctx.lineTo(px + dsx * diag, py + dsy * diag);
    }
    ctx.stroke();
  };
  // Dot lattice, same rebasing trick; dots are screen-axis squares (at dot
  // size rotation is imperceptible and this stays allocation-free).
  const dots = (sp, r, color) => {
    const ib = Math.floor((mnx + mxx) / 2 / sp), jb = Math.floor((mny + mxy) / 2 / sp);
    const i0 = Math.floor(mnx / sp) - ib, i1 = Math.ceil(mxx / sp) - ib;
    const j0 = Math.floor(mny / sp) - jb, j1 = Math.ceil(mxy / sp) - jb;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 12000) return;          // perf guard
    const B = l2s(ib * sp, jb * sp);
    const ax = z * ca * sp, ay = z * sa * sp;                  // screen step per +i
    const bx = -z * sa * sp, by = z * ca * sp;                 // screen step per +j
    ctx.fillStyle = color;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        ctx.fillRect(B.x + i * ax + j * bx - r / 2, B.y + i * ay + j * by - r / 2, r, r);
      }
    }
  };
  // Graph-paper axes + one number per square along both axes. Numbers are
  // square indices (the square size IS the spacing setting), thinned out when
  // squares shrink below ~26px so labels never collide.
  const axes = (sp, withNumbers) => {
    const O = l2s(0, 0);
    const L = Math.hypot(W, H);
    ctx.strokeStyle = strong; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(O.x - ca * L, O.y - sa * L); ctx.lineTo(O.x + ca * L, O.y + sa * L);
    ctx.moveTo(O.x + sa * L, O.y - ca * L); ctx.lineTo(O.x - sa * L, O.y + ca * L);
    ctx.stroke();
    if (!withNumbers) return;
    const every = Math.max(1, Math.ceil(26 / (sp * z)));
    const ax = z * ca * sp, ay = z * sa * sp, bx = -z * sa * sp, by = z * ca * sp;
    ctx.fillStyle = `rgba(${ink},${(0.42 * op + 0.18).toFixed(3)})`;
    ctx.font = '700 10px Nunito, system-ui, sans-serif';
    let i0 = Math.ceil(mnx / sp), i1 = Math.floor(mxx / sp);
    i0 = Math.ceil(i0 / every) * every; i1 = Math.floor(i1 / every) * every;
    if (i1 - i0 <= 400) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (let i = i0; i <= i1; i += every) {
        ctx.fillText(String(i), O.x + i * ax + 3, O.y + i * ay + 3);
      }
    }
    let j0 = Math.ceil(mny / sp), j1 = Math.floor(mxy / sp);
    j0 = Math.ceil(j0 / every) * every; j1 = Math.floor(j1 / every) * every;
    if (j1 - j0 <= 400) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      for (let j = j0; j <= j1; j += every) {
        if (j === 0) continue;                                 // origin labelled once above
        ctx.fillText(String(j), O.x + j * bx - 3, O.y + j * by - 3);
      }
    }
  };
  const lw = 1;                                                // hairline in screen px
  switch (g.style) {
    case 'grid':
      family(0, s, faint, lw); family(90, s, faint, lw);
      family(0, s, mid, lw, 5); family(90, s, mid, lw, 5);
      break;
    case 'graph':
      family(0, s, faint, lw); family(90, s, faint, lw);
      family(0, s, mid, lw, 5); family(90, s, mid, lw, 5);
      axes(s, true);
      break;
    case 'dotted':
      dots(s, Math.max(1.4, s * z * 0.06), `rgba(${ink},${(0.28 * op + 0.08).toFixed(3)})`);
      break;
    case 'lined':
      family(0, s * 1.6, `rgba(${ink},${(0.16 * op + 0.05).toFixed(3)})`, lw);
      break;
    case 'iso':
      family(0, s, faint, lw); family(60, s, faint, lw); family(120, s, faint, lw);
      break;
    default: break; // 'blank' handled above
  }
}
