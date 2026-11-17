(function () {
var module = { exports: {} };
"use strict";
/* ==========================================================================
   INK LAB 2 — moteur de rendu (JavaScript pur, aucune dépendance Photoshop)
   --------------------------------------------------------------------------
   • Tailles exprimées en « unités » = hauteur d'une ligne de texte : l'aperçu
     et le rendu pleine résolution donnent exactement le même dessin.
   • Les contours (encre, érosion, éclats, éclaboussures) sont des champs
     implicites seuillés avec un anticrénelage d'un pixel : bords nets, propres,
     quelle que soit la taille du titre.
   ========================================================================== */

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function smoothstep(e0, e1, x) {
  let t = (x - e0) / ((e1 - e0) || 1e-6);
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return t * t * (3 - 2 * t);
}
const pc = (v, d) => (v == null ? d : v) / 100;

/* ---------- Bruit ------------------------------------------------------- */
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f + i * 7.13, y * f - i * 3.71, s + i * 17);
    norm += amp; amp *= 0.5; f *= 2.07;
  }
  return sum / norm;
}

/* ---------- Échantillonnage -------------------------------------------- */
function sample(a, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let v00 = 0, v10 = 0, v01 = 0, v11 = 0;
  if (y0 >= 0 && y0 < h) {
    const r = y0 * w;
    if (x0 >= 0 && x0 < w) v00 = a[r + x0];
    if (x0 + 1 >= 0 && x0 + 1 < w) v10 = a[r + x0 + 1];
  }
  if (y0 + 1 >= 0 && y0 + 1 < h) {
    const r = (y0 + 1) * w;
    if (x0 >= 0 && x0 < w) v01 = a[r + x0];
    if (x0 + 1 >= 0 && x0 + 1 < w) v11 = a[r + x0 + 1];
  }
  return v00 + (v10 - v00) * fx + (v01 - v00) * fy + (v00 - v10 - v01 + v11) * fx * fy;
}

/* ---------- Flous (3 passes boîte ≈ gaussien) -------------------------- */
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
function boxH(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    const lim = Math.min(r, w - 1);
    for (let x = 0; x <= lim; x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * iarr;
      const xo = x - r, xi = x + r + 1;
      if (xo >= 0) acc -= src[row + xo];
      if (xi < w) acc += src[row + xi];
    }
  }
}
function boxV(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    const lim = Math.min(r, h - 1);
    for (let y = 0; y <= lim; y++) acc += src[y * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * iarr;
      const yo = y - r, yi = y + r + 1;
      if (yo >= 0) acc -= src[yo * w + x];
      if (yi < h) acc += src[yi * w + x];
    }
  }
}
/** Flou gaussien (renvoie un NOUVEAU tableau, ou l'entrée si sigma négligeable). */
function gauss(a, w, h, sigma) {
  if (!(sigma > 0.35)) return a;
  const boxes = boxesForGauss(sigma, 3);
  const s = Float32Array.from(a), t = new Float32Array(a.length);
  for (const b of boxes) {
    const r = (b - 1) >> 1; if (r < 1) continue;
    boxH(s, t, w, h, r); boxV(t, s, w, h, r);
  }
  return s;
}
function gaussRows(a, w, h, sigma) {
  if (!(sigma > 0.35)) return a;
  const boxes = boxesForGauss(sigma, 3);
  let s = Float32Array.from(a), t = new Float32Array(a.length);
  for (const b of boxes) {
    const r = (b - 1) >> 1; if (r < 1) continue;
    boxH(s, t, w, h, r); const x = s; s = t; t = x;
  }
  return s;
}

/** Seuil anticrénelé : contour net à ~softPx pixels, quel que soit le champ. */
function aaThreshold(v, w, h, t, softPx) {
  const out = new Float32Array(w * h);
  const k = 1 / Math.max(0.75, softPx);
  for (let y = 0; y < h; y++) {
    const r = y * w, ru = (y > 0 ? y - 1 : y) * w, rd = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const i = r + x;
      const d = v[i] - t;
      const gx = (v[r + (x < w - 1 ? x + 1 : x)] - v[r + (x > 0 ? x - 1 : x)]) * 0.5;
      const gy = (v[rd + x] - v[ru + x]) * 0.5;
      const g = Math.sqrt(gx * gx + gy * gy);
      if (g < 1e-7) { out[i] = d > 0 ? 1 : 0; continue; }
      const o = d / g * k + 0.5;
      out[i] = o < 0 ? 0 : (o > 1 ? 1 : o);
    }
  }
  return out;
}

/* ---------- Repère tourné (effets à axe) -------------------------------- */
function toFrame(a, w, h, ang, cx, cy) {
  const c = Math.cos(ang), s = Math.sin(ang);
  if (Math.abs(ang) < 1e-5) return { b: a, W: w, H: h, minX: -cx, minY: -cy, c: 1, s: 0, cx, cy, w, h, identity: true };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const dx = px - cx, dy = py - cy;
    const fx = c * dx + s * dy, fy = -s * dx + c * dy;
    if (fx < minX) minX = fx; if (fx > maxX) maxX = fx;
    if (fy < minY) minY = fy; if (fy > maxY) maxY = fy;
  }
  minX = Math.floor(minX); minY = Math.floor(minY);
  const W = Math.ceil(maxX) - minX, H = Math.ceil(maxY) - minY;
  const b = new Float32Array(W * H);
  for (let Y = 0; Y < H; Y++) {
    const fy = Y + minY + 0.5;
    for (let X = 0; X < W; X++) {
      const fx = X + minX + 0.5;
      b[Y * W + X] = sample(a, w, h, c * fx - s * fy + cx - 0.5, s * fx + c * fy + cy - 0.5);
    }
  }
  return { b, W, H, minX, minY, c, s, cx, cy, w, h, identity: false };
}
function fromFrame(F) {
  if (F.identity) return F.b;
  const { b, W, H, minX, minY, c, s, cx, cy, w, h } = F;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      out[y * w + x] = sample(b, W, H, c * dx + s * dy - minX - 0.5, -s * dx + c * dy - minY - 0.5);
    }
  }
  return out;
}

/* ---------- Champs de bruit mis en cache -------------------------------- */
function field(ctx, name, fn) {
  const key = name + "|" + ctx.base;
  if (ctx.cache && ctx.cache.has(key)) return ctx.cache.get(key);
  const { w, h } = ctx;
  const out = new Float32Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) out[i] = fn(x + 0.5, y + 0.5);
  if (ctx.cache) { if (ctx.cache.size > 40) ctx.cache.clear(); ctx.cache.set(key, out); }
  return out;
}

/* ======================================================================= */
/*  GÉOMÉTRIE : déformation façon « Déformation du texte » + perspective     */
/* ======================================================================= */
const WARP_STYLES = [
  ["none", "Aucune"], ["arc", "Arc"], ["arcLower", "Arc inférieur"], ["arcUpper", "Arc supérieur"],
  ["arch", "Arche"], ["bulge", "Renflement"], ["flag", "Drapeau"], ["wave", "Onde"], ["fish", "Poisson"],
  ["rise", "Hausse"], ["fisheye", "Fisheye"], ["inflate", "Gonflement"], ["squeeze", "Compression"], ["twist", "Torsion"]
];
function hasGeom(P) {
  const st = P.warpStyle || "none";
  return (st !== "none" && (P.warpBend || 0) !== 0) || !!P.perspH || !!P.perspV || !!P.skew || !!P.rotate ||
    (P.scaleX != null && P.scaleX !== 100) || (P.scaleY != null && P.scaleY !== 100);
}
function geomForward(P, hw, hh) {
  const b = pc(P.warpBend, 0), st = P.warpStyle || "none";
  const H = pc(P.perspH, 0), V = pc(P.perspV, 0), sk = pc(P.skew, 0);
  const rot = -(P.rotate || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
  const sx = pc(P.scaleX, 100), sy = pc(P.scaleY, 100);
  const R0 = Math.abs(b) > 1e-3 ? hw / (b * Math.PI / 2) : 0;
  const M = Math.max(hw, hh);
  return function (u, v) {
    let X = u * hw, Y = v * hh;
    switch (st) {
      case "arc": Y -= b * (1 - u * u) * hw * 0.42; break;
      case "arcLower": Y += b * (1 - u * u) * hw * 0.32 * ((v + 1) / 2); break;
      case "arcUpper": Y -= b * (1 - u * u) * hw * 0.32 * ((1 - v) / 2); break;
      case "arch": if (R0) { const th = u * b * Math.PI / 2, r = R0 - Y; X = r * Math.sin(th); Y = R0 - r * Math.cos(th); } break;
      case "bulge": Y *= 1 + b * 0.6 * (1 - u * u); break;
      case "flag": Y += b * hw * 0.12 * Math.sin(Math.PI * u); break;
      case "wave": Y += b * hw * 0.10 * Math.sin(Math.PI * u * 1.5 + (v + 1) * Math.PI * 0.5); break;
      case "fish": { const s = (u + 1) / 2; Y *= 1 + b * 0.9 * Math.sin(Math.PI * s) * (1 - 0.6 * s); break; }
      case "rise": Y -= b * hw * 0.24 * Math.sin(Math.PI * u / 2); break;
      case "fisheye": { const k = 1 + b * 0.55 * Math.max(0, 1 - (u * u + v * v) / 2); X *= k; Y *= k; break; }
      case "inflate": { const x0 = X; X = x0 * (1 + b * 0.3 * (1 - v * v)); Y *= 1 + b * 0.55 * (1 - u * u); break; }
      case "squeeze": { X *= 1 - b * 0.3 * (1 - v * v); Y *= 1 + b * 0.45 * u * u; break; }
      case "twist": { const rr = Math.sqrt(X * X + Y * Y) / M, an = b * Math.PI * 0.6 * Math.max(0, 1 - rr), c = Math.cos(an), s = Math.sin(an); const x2 = X * c - Y * s; Y = X * s + Y * c; X = x2; break; }
      default: break;
    }
    if (H || V) {
      const ww = Math.max(0.25, 1 - H * 0.42 * (X / hw) - V * 0.42 * (Y / hh));
      X /= ww; Y /= ww;
    }
    if (sk) X -= sk * Y * 0.6;
    X *= sx; Y *= sy;
    if (rot) { const x2 = X * cr - Y * sr; Y = X * sr + Y * cr; X = x2; }
    return [X, Y];
  };
}
/** Boîte englobante du texte déformé (px, relative au centre). */
function geomExtent(P, tw, th) {
  const hw = tw / 2, hh = th / 2;
  if (!hasGeom(P)) return { minX: -hw, maxX: hw, minY: -hh, maxY: hh };
  const F = geomForward(P, hw, hh);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (u, v) => { const [X, Y] = F(u, v); if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y; };
  for (let i = 0; i <= 48; i++) { const t = -1 + 2 * i / 48; add(t, -1); add(t, 1); add(-1, t); add(1, t); add(t, 0); }
  return { minX, maxX, minY, maxY };
}
function stageGeom(a, P, ctx) {
  if (!hasGeom(P)) return a;
  const { w, h } = ctx;
  const hw = ctx.tw / 2, hh = ctx.th / 2, cx = ctx.cx, cy = ctx.cy;
  const F = geomForward(P, hw, hh);
  const mu = 0.03 + 3 / Math.max(hw, 1), mv = 0.03 + 3 / Math.max(hh, 1);
  const GX = Math.min(240, Math.max(24, Math.round(Math.sqrt(hw / hh) * 72)));
  const GY = Math.min(180, Math.max(16, Math.round(Math.sqrt(hh / hw) * 72)));
  const nx = GX + 1, ny = GY + 1;
  const DX = new Float32Array(nx * ny), DY = new Float32Array(nx * ny), SX = new Float32Array(nx * ny), SY = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u = -1 - mu + (2 + 2 * mu) * i / GX, v = -1 - mv + (2 + 2 * mv) * j / GY;
    const [X, Y] = F(u, v); const k = j * nx + i;
    DX[k] = cx + X; DY[k] = cy + Y; SX[k] = cx + u * hw - 0.5; SY[k] = cy + v * hh - 0.5;
  }
  const out = new Float32Array(w * h);
  const tri = (p0, p1, p2) => {
    const x0 = DX[p0], y0 = DY[p0], x1 = DX[p1], y1 = DY[p1], x2 = DX[p2], y2 = DY[p2];
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-9) return;
    const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 0.5)), maxx = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 0.5)), maxy = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    const e = -1e-4 * Math.abs(den) / den;
    for (let py = miny; py <= maxy; py++) {
      const Yc = py + 0.5;
      for (let px = minx; px <= maxx; px++) {
        const Xc = px + 0.5;
        const l0 = ((y1 - y2) * (Xc - x2) + (x2 - x1) * (Yc - y2)) / den;
        const l1 = ((y2 - y0) * (Xc - x2) + (x0 - x2) * (Yc - y2)) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
        const val = sample(a, w, h, l0 * SX[p0] + l1 * SX[p1] + l2 * SX[p2], l0 * SY[p0] + l1 * SY[p1] + l2 * SY[p2]);
        const i = py * w + px;
        if (val > out[i]) out[i] = val;
      }
    }
    return e;
  };
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const k = j * nx + i;
    tri(k, k + 1, k + nx + 1); tri(k, k + nx + 1, k + nx);
  }
  // nouvelle boîte du texte (pour les effets à axe et la progression du flou)
  const ext = geomExtent(P, ctx.tw, ctx.th);
  ctx.ox = cx + ext.minX; ctx.oy = cy + ext.minY;
  ctx.tw = ext.maxX - ext.minX; ctx.th = ext.maxY - ext.minY;
  ctx.cx = ctx.ox + ctx.tw / 2; ctx.cy = ctx.oy + ctx.th / 2;
  return out;
}

/* ---------- Marge nécessaire autour du texte (en unités) ---------------- */
/** dims = { tw, th, unit } (px à la résolution utilisée) */
function computePad(P, dims) {
  let p = 0.12;
  p += pc(P.warp, 0) * 0.9;
  p += pc(P.slices, 0) * 1.0;
  p += Math.min(2.4, pc(P.streaks, 0) * 2.2);
  p += pc(P.inkBleed, 0) * 0.22 + Math.max(0, pc(P.inkSpread, 0)) * 0.12;
  p += pc(P.speckles, 0) > 0 ? 0.35 : 0;
  p += pc(P.blur, 0) * 0.4 * 2.6 + pc(P.motion, 0) * 1.1 * 2.4 + pc(P.progressive, 0) * ((P.progType | 0) === 1 ? 1.3 * 2.2 : 0.55 * 2.6);
  if ((P.colorMode | 0) === 2) p += (0.02 + pc(P.gmSpread, 30) * 0.6) * 2.4;
  if ((P.glow || 0) > 0) p += (0.03 + pc(P.glowRadius, 30) * 0.9) * 2.6;
  p += pc(P.chroma, 0) * 0.12;
  p = Math.min(3.4, p);
  if (dims && hasGeom(P)) {
    const e = geomExtent(P, dims.tw, dims.th);
    const extra = Math.max(0, -e.minX - dims.tw / 2, e.maxX - dims.tw / 2, -e.minY - dims.th / 2, e.maxY - dims.th / 2);
    p += extra / Math.max(1, dims.unit);
  }
  return p;
}

/* ======================================================================= */
/*  ÉTAPES DE MATIÈRE                                                       */
/* ======================================================================= */

function stageWarp(a, P, ctx) {
  const amt = pc(P.warp, 0); if (amt <= 0) return a;
  const { w, h, unit, ox, oy } = ctx;
  const f = 1 / (0.25 + pc(P.warpSize, 40) * 3.0);
  const nx = field(ctx, "wx" + f, (x, y) => fbm((x - ox) / unit * f, (y - oy) / unit * f, ctx.seed + 101, 2));
  const ny = field(ctx, "wy" + f, (x, y) => fbm((x - ox) / unit * f + 13.7, (y - oy) / unit * f - 7.1, ctx.seed + 202, 2));
  const disp = amt * 2.6 * unit;
  const out = new Float32Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    out[i] = sample(a, w, h, x + (nx[i] - 0.5) * disp * 2, y + (ny[i] - 0.5) * disp * 2);
  }
  return out;
}

function stageErode(a, P, ctx) {
  const amt = pc(P.erode, 0); if (amt <= 0) return a;
  const { w, h, unit, ox, oy } = ctx;
  const f = 1 / (0.01 + pc(P.erodeSize, 30) * 0.3);
  const nz = field(ctx, "er" + f, (x, y) => fbm((x - ox) / unit * f, (y - oy) / unit * f, ctx.seed + 303, 3));
  const B = gauss(a, w, h, 0.012 * unit);
  const W = gauss(a, w, h, (0.02 + pc(P.erodeSize, 30) * 0.08) * unit);
  const v = new Float32Array(w * h);
  for (let i = 0; i < v.length; i++) {
    const e = Math.min(1, 4 * W[i] * (1 - W[i]) + 0.15);
    v[i] = B[i] + (nz[i] - 0.5) * amt * 2.4 * e - amt * 0.05;
  }
  return aaThreshold(v, w, h, 0.5, 1);
}

/** Disques anticrénelés répartis sur une grille aléatoire (éclaboussures / pores). */
function dots(ctx, cellPx, sizeK, zoneFn, salt) {
  const { w, h, ox, oy } = ctx;
  const out = new Float32Array(w * h);
  const s = ctx.seed + salt;
  for (let y = 0, i = 0; y < h; y++) {
    const gyf = (y + 0.5 - oy) / cellPx;
    const gy = Math.floor(gyf);
    for (let x = 0; x < w; x++, i++) {
      const gxf = (x + 0.5 - ox) / cellPx, gx = Math.floor(gxf);
      let best = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const cx = gx + k, cy = gy + j;
        const pz = zoneFn(cx, cy);
        if (pz <= 0 || hash2(cx, cy, s) > pz) continue;
        const dcx = cx + 0.15 + 0.7 * hash2(cx, cy, s + 1), dcy = cy + 0.15 + 0.7 * hash2(cx, cy, s + 2);
        const r = (0.05 + 0.32 * Math.pow(hash2(cx, cy, s + 3), 2.2)) * sizeK;
        const dx = (gxf - dcx) * cellPx, dy = (gyf - dcy) * cellPx;
        const d = Math.sqrt(dx * dx + dy * dy) - r * cellPx;
        const o = 0.5 - d;
        if (o > best) best = o > 1 ? 1 : o;
      }
      out[i] = best;
    }
  }
  return out;
}

function stageInk(a, P, ctx) {
  const bleed = pc(P.inkBleed, 0), sp = pc(P.speckles, 0), po = pc(P.pores, 0);
  if (bleed <= 0 && sp <= 0 && po <= 0) return a;
  const { w, h, unit, ox, oy } = ctx; const s = ctx.seed;
  let out = a;
  if (bleed > 0) {
    const B = gauss(a, w, h, (0.006 + bleed * 0.085) * unit);
    const cell = 0.03 + pc(P.inkGrain, 30) * 0.42, f = 1 / cell;
    const nz = field(ctx, "ink" + f, (x, y) => fbm((x - ox) / unit * f, (y - oy) / unit * f, s + 404, 3));
    const fine = field(ctx, "inkf" + f, (x, y) => vnoise((x - ox) / unit * f * 5.3, (y - oy) / unit * f * 5.3, s + 414));
    const rough = pc(P.inkRough, 40);
    const t = 0.5 - pc(P.inkSpread, 0) * 0.36;
    const v = new Float32Array(w * h);
    for (let i = 0; i < v.length; i++) {
      const b = B[i], e = 4 * b * (1 - b);
      v[i] = b + ((nz[i] - 0.5) * 1.15 + (fine[i] - 0.5) * 0.22) * rough * e;
    }
    if ((P.inkStyle | 0) === 1) {
      // Bord « toner » (photocopie) : transition large, tramée en points nets
      const wv = 0.05 + (1 - pc(P.inkSharp, 85)) * 0.32;
      const cell = Math.max(0.5, 1.4 * ctx.pxScale), ts = s + 909;
      out = new Float32Array(w * h);
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        const q = smoothstep(t - wv, t + wv * 0.4, v[i]);
        if (q >= 0.995) { out[i] = 1; continue; }
        if (q <= 0.005) continue;
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const hn = (hash2(cx, cy, ts) * 0.6 + hash2(cx >> 1, cy >> 1, ts + 1) * 0.4);
        out[i] = q * q > hn ? 1 : 0;
      }
    } else {
      const softPx = 1 + (1 - pc(P.inkSharp, 85)) * 0.05 * unit;
      out = aaThreshold(v, w, h, t, softPx);
    }
  }
  if (sp > 0 || po > 0) {
    const Z = gauss(out, w, h, 0.22 * unit);
    const zAt = (cx, cy, cell) => {
      const px = Math.round(ox + (cx + 0.5) * cell), py = Math.round(oy + (cy + 0.5) * cell);
      if (px < 0 || py < 0 || px >= w || py >= h) return 0;
      return Z[py * w + px];
    };
    if (sp > 0) {
      const cell = (0.035 + pc(P.speckSize, 40) * 0.12) * unit;
      const D = dots(ctx, cell, 1, (cx, cy) => { const z = zAt(cx, cy, cell); return sp * 0.9 * smoothstep(0.01, 0.12, z) * (1 - smoothstep(0.45, 0.75, z)); }, 505);
      if (out === a) out = Float32Array.from(a);
      for (let i = 0; i < out.length; i++) if (D[i] > out[i]) out[i] = D[i];
    }
    if (po > 0) {
      const cell = (0.03 + pc(P.speckSize, 40) * 0.08) * unit;
      const D = dots(ctx, cell, 0.8, (cx, cy) => po * 0.8 * smoothstep(0.75, 0.95, zAt(cx, cy, cell)), 606);
      if (out === a) out = Float32Array.from(a);
      for (let i = 0; i < out.length; i++) if (D[i] > 0) out[i] *= 1 - D[i];
    }
  }
  return out;
}

/* ---------- Destruction (repère tourné selon l'axe) --------------------- */
/* Tranches et entailles : calculées directement dans le canevas (aucun ré-échantillonnage du texte) */
function sliceOffset(fy, P, ctx) {
  const unit = ctx.unit, s = ctx.seed;
  const count = Math.max(1, P.sliceCount || 8), dens = pc(P.sliceDensity, 50);
  const band = Math.floor((fy / unit) * count);
  if (hash2(band, 11, s) >= dens) return 0;
  const r = hash2(band, 23, s) * 2 - 1;
  return (r < 0 ? -1 : 1) * (0.25 + 0.75 * Math.abs(r)) * pc(P.slices, 0) * 0.9 * unit;
}
function cutFactor(fy, P, ctx) {
  const unit = ctx.unit, s = ctx.seed;
  const dens = pc(P.cuts, 0), gap = (0.006 + pc(P.cutWidth, 30) * 0.05) * unit, spacing = 0.16 * unit;
  const j = Math.floor(fy / spacing); let k = 1;
  for (let q = j - 1; q <= j + 1; q++) {
    if (hash2(q, 71, s) >= dens * 0.6) continue;
    const c = (q + 0.5 + (hash2(q, 73, s) - 0.5) * 0.6) * spacing;
    const hw = gap * (0.4 + 0.6 * hash2(q, 79, s)) / 2;
    const v = clamp01(Math.abs(fy - c) - hw + 0.5);
    if (v < k) k = v;
  }
  return k;
}

/** Éclats : pointes effilées pleines, contour anticrénelé (champ implicite). */
function frameShards(F, P, ctx, b) {
  const { W, H, minY } = F; const unit = ctx.unit, s = ctx.seed;
  const amt = pc(P.streaks, 0), dens = pc(P.streakDensity, 40), dir = P.streakDir | 0;
  const thick = (0.01 + pc(P.streakWidth, 30) * 0.32) * unit;
  const maxLen = amt * 2.2 * unit;
  const L = (yc, salt) => {
    const j = Math.floor(yc / thick); let best = 0;
    for (let q = j - 1; q <= j + 1; q++) {
      if (hash2(q, 31 + salt, s) >= dens) continue;
      const c = (q + 0.2 + 0.6 * hash2(q, 37 + salt, s)) * thick;
      const hw = thick * (0.25 + 0.55 * hash2(q, 41 + salt, s));
      const pk = maxLen * (0.12 + 0.88 * Math.pow(hash2(q, 47 + salt, s), 1.6));
      const v = pk * (1 - Math.abs(yc - c) / hw);
      if (v > best) best = v;
    }
    return best;
  };
  const src = F.b;
  for (let Y = 0; Y < H; Y++) {
    const yc = Y + minY + 0.5;
    const base = Y * W;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0 && dir === 2) continue;
      if (pass === 1 && dir === 1) continue;
      const salt = pass * 100;
      const Lc = L(yc, salt); if (Lc < 0.75) continue;
      const g = Math.sqrt(1 + Math.pow((L(yc + 1, salt) - L(yc - 1, salt)) * 0.5, 2));
      let edge = -1e9;
      if (pass === 0) {
        for (let X = 0; X < W; X++) {
          const v = src[base + X];
          if (v < 0.5 && X > 0 && src[base + X - 1] >= 0.5) { const pv = src[base + X - 1]; edge = X - 1 + (pv - 0.5) / Math.max(1e-4, pv - v); }
          const d = X - edge;
          if (d <= Lc + 2) { const a = clamp01((Lc - d) / g + 0.5); if (a > b[base + X]) b[base + X] = a; }
          if (v >= 0.5) edge = X;
        }
      } else {
        for (let X = W - 1; X >= 0; X--) {
          const v = src[base + X];
          if (v < 0.5 && X < W - 1 && src[base + X + 1] >= 0.5) { const pv = src[base + X + 1]; edge = X + 1 - (pv - 0.5) / Math.max(1e-4, pv - v); }
          const d = edge - X;
          if (edge > -1e8 && d <= Lc + 2) { const a = clamp01((Lc - d) / g + 0.5); if (a > b[base + X]) b[base + X] = a; }
          if (v >= 0.5) edge = X;
        }
      }
    }
  }
}

function stageDestroy(a, P, ctx) {
  const hasS = (P.slices || 0) > 0, hasC = (P.cuts || 0) > 0, hasT = (P.streaks || 0) > 0;
  if (!hasS && !hasT && !hasC) return a;
  const { w, h } = ctx;
  const ang = -(P.destroyAngle || 0) * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
  const axisAligned = Math.abs(s) < 1e-6;
  let out = Float32Array.from(a);
  if (hasT) {
    const F = toFrame(a, w, h, ang, ctx.cx, ctx.cy);
    const S = new Float32Array(F.W * F.H);
    frameShards(F, P, ctx, S);
    const back = F.identity ? S : fromFrame(Object.assign({}, F, { b: S }));
    for (let i = 0; i < out.length; i++) if (back[i] > out[i]) out[i] = back[i];
  }
  if (hasC) {
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (out[i] <= 0) continue;
      const fy = -s * (x + 0.5 - ctx.cx) + c * (y + 0.5 - ctx.cy);
      out[i] *= cutFactor(fy, P, ctx);
    }
  }
  if (hasS) {
    const src = out; out = new Float32Array(w * h);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const fy = -s * (x + 0.5 - ctx.cx) + c * (y + 0.5 - ctx.cy);
      let off = sliceOffset(fy, P, ctx);
      if (off === 0) { out[i] = src[i]; continue; }
      if (axisAligned) { off = Math.round(off) * (c > 0 ? 1 : -1); const xs = x - off; out[i] = (xs >= 0 && xs < w) ? src[y * w + xs] : 0; }
      else out[i] = sample(src, w, h, x - off * c, y - off * s);
    }
  }
  return out;
}

/* ---------- Flous ------------------------------------------------------- */
function stageBlur(a, P, ctx) {
  const { w, h, unit } = ctx;
  if ((P.blur || 0) > 0) a = gauss(a, w, h, pc(P.blur, 0) * 0.4 * unit);
  const mo = pc(P.motion, 0), pg = pc(P.progressive, 0), fd = pc(P.fade, 0);
  const ang = -(P.blurAngle || 0) * Math.PI / 180;
  // repères de progression (utilisés aussi pour les poignées de l'aperçu)
  const c = Math.cos(ang), s = Math.sin(ang);
  let lo = Infinity, hi = -Infinity;
  for (const [px, py] of [[ctx.ox, ctx.oy], [ctx.ox + ctx.tw, ctx.oy], [ctx.ox, ctx.oy + ctx.th], [ctx.ox + ctx.tw, ctx.oy + ctx.th]]) {
    const fx = c * (px - ctx.cx) + s * (py - ctx.cy);
    if (fx < lo) lo = fx; if (fx > hi) hi = fx;
  }
  const p0 = pc(P.progStart, 30), p1 = Math.max(p0 + 0.01, pc(P.progEnd, 100));
  const startPos = lo + p0 * (hi - lo), endPos = lo + p1 * (hi - lo);
  ctx.meta.prog = { c, s, cx: ctx.cx, cy: ctx.cy, lo, hi, startPos, endPos, active: pg > 0 || fd > 0 };
  if (mo <= 0 && pg <= 0 && fd <= 0) return a;
  const F = toFrame(a, w, h, ang, ctx.cx, ctx.cy);
  if (mo > 0) F.b = gaussRows(F.b, F.W, F.H, mo * 1.1 * unit);
  if (pg > 0 || fd > 0) {
    const { W, H } = F;
    const span = Math.max(1, endPos - startPos);
    const tcol = new Float32Array(W);
    for (let X = 0; X < W; X++) tcol[X] = clamp01((X + F.minX + 0.5 - startPos) / span);
    if (pg > 0) {
      const dirMode = (P.progType | 0) === 1;
      const maxSig = pg * (dirMode ? 1.3 : 0.55) * unit;
      const bl = dirMode ? (sg => gaussRows(F.b, W, H, sg)) : (sg => gauss(F.b, W, H, sg));
      const Lv = [F.b, bl(maxSig * 0.12), bl(maxSig * 0.32), bl(maxSig * 0.6), bl(maxSig)];
      const out = new Float32Array(W * H);
      for (let Y = 0, i = 0; Y < H; Y++) for (let X = 0; X < W; X++, i++) {
        const q = smoothstep(0, 1, tcol[X]) * 4;
        const k = Math.min(3, Math.floor(q)), fr = q - k;
        out[i] = Lv[k][i] * (1 - fr) + Lv[k + 1][i] * fr;
      }
      F.b = out;
    }
    if (fd > 0) {
      if (F.b === a) F.b = Float32Array.from(a);
      for (let Y = 0, i = 0; Y < H; Y++) for (let X = 0; X < W; X++, i++) F.b[i] *= 1 - fd * smoothstep(0, 1, tcol[X]);
    }
  }
  return fromFrame(F);
}

function stageStipple(a, P, ctx) {
  const p = pc(P.stipple, 0); if (p <= 0 || (P.colorMode | 0) === 2) return a;
  const { w, h } = ctx;
  if (a === ctx.input) a = Float32Array.from(a);
  const cell = Math.max(0.5, (P.grainSize || 2) * ctx.pxScale);
  const s = ctx.seed + 707;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const v = a[i]; if (v <= 0.002 || v >= 0.998) continue;
    const t = hash2(Math.floor(x / cell), Math.floor(y / cell), s);
    a[i] = v + ((v > t ? 1 : 0) - v) * p;
  }
  return a;
}

/* ======================================================================= */
/*  TEXTURES                                                                */
/* ======================================================================= */
/** img = { width, height, data, channels } (données 8 bits, 1, 3 ou 4 canaux) */
function prepareTexture(img, gray) {
  const w = img.width, h = img.height, inC = img.channels || (img.data.length / (w * h));
  const ch = gray ? 1 : 3;
  const data = new Uint8Array(w * h * ch);
  for (let i = 0; i < w * h; i++) {
    const j = i * inC;
    if (ch === 1) data[i] = inC >= 3 ? Math.round(0.2126 * img.data[j] + 0.7152 * img.data[j + 1] + 0.0722 * img.data[j + 2]) : img.data[j];
    else { const k = i * 3; data[k] = img.data[j]; data[k + 1] = img.data[inC >= 3 ? j + 1 : j]; data[k + 2] = img.data[inC >= 3 ? j + 2 : j]; }
  }
  const tex = { w, h, ch, mips: [{ w, h, data }] };
  // statistiques (niveaux automatiques)
  const m = texMip(tex, Math.max(0, Math.floor(Math.log2(Math.max(w, h) / 256))));
  let sum = 0, sum2 = 0; const n = m.w * m.h;
  for (let i = 0; i < n; i++) { const l = texLumAt(m, i) / 255; sum += l; sum2 += l * l; }
  tex.mean = sum / n; tex.std = Math.max(0.02, Math.sqrt(Math.max(0, sum2 / n - tex.mean * tex.mean)));
  return tex;
}
function texLumAt(m, i) {
  if (m.ch === 1 || !m.ch && m.data.length === m.w * m.h) return m.data[i];
  const k = i * 3; return 0.2126 * m.data[k] + 0.7152 * m.data[k + 1] + 0.0722 * m.data[k + 2];
}
function texMip(tex, L) {
  while (tex.mips.length <= L) {
    const p = tex.mips[tex.mips.length - 1];
    const w = Math.max(1, p.w >> 1), h = Math.max(1, p.h >> 1), ch = tex.ch;
    const d = new Uint8Array(w * h * ch);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      const x0 = Math.min(p.w - 1, x * 2), x1 = Math.min(p.w - 1, x * 2 + 1), y0 = Math.min(p.h - 1, y * 2), y1 = Math.min(p.h - 1, y * 2 + 1);
      d[(y * w + x) * ch + c] = (p.data[(y0 * p.w + x0) * ch + c] + p.data[(y0 * p.w + x1) * ch + c] + p.data[(y1 * p.w + x0) * ch + c] + p.data[(y1 * p.w + x1) * ch + c] + 2) >> 2;
    }
    tex.mips.push({ w, h, data: d });
  }
  const m = tex.mips[L]; m.ch = tex.ch; return m;
}
function mirror(i, n) { const p = 2 * n; i %= p; if (i < 0) i += p; return i < n ? i : p - 1 - i; }

/**
 * Projette une texture sur le canevas. Renvoie { lum (0..1 normalisé autour de 0.5), r, g, b (0..1) }.
 * o = { scale %, angle °, x %, y %, contrast, invert }, ancré sur le centre du texte.
 */
function projectTexture(tex, ctx, o, needColor) {
  const { w, h } = ctx; const n = w * h;
  const sc = Math.max(0.02, (o.scale == null ? 100 : o.scale) / 100);
  const fp = 1 / (ctx.pxScale * sc);
  const L = Math.max(0, Math.min(10, Math.floor(Math.log2(Math.max(1, fp)))));
  const m = texMip(tex, L); const f = 1 / (1 << L);
  const ang = -(o.angle || 0) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const offX = ((o.x || 0) / 100) * tex.w, offY = ((o.y || 0) / 100) * tex.h;
  const lum = new Float32Array(n);
  const R = needColor ? new Float32Array(n) : null, G = needColor ? new Float32Array(n) : null, B = needColor ? new Float32Array(n) : null;
  const k = (1 + (o.contrast || 0) / 100 * (o.contrast > 0 ? 2.5 : 1)) / (3 * tex.std);
  const mean = tex.mean;
  const ch = tex.ch, mw = m.w, mh = m.h, d = m.data;
  const ax = ctx.ax, ay = ctx.ay;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const dx = (x + 0.5 - ax) / ctx.pxScale, dy = (y + 0.5 - ay) / ctx.pxScale;
    const tx = ((dx * ca - dy * sa) / sc + offX + tex.w / 2) * f - 0.5;
    const ty = ((dx * sa + dy * ca) / sc + offY + tex.h / 2) * f - 0.5;
    const x0 = Math.floor(tx), y0 = Math.floor(ty), fx = tx - x0, fy = ty - y0;
    const xa = mirror(x0, mw), xb = mirror(x0 + 1, mw), ya = mirror(y0, mh), yb = mirror(y0 + 1, mh);
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    let l;
    if (ch === 1) {
      l = (d[ya * mw + xa] * w00 + d[ya * mw + xb] * w10 + d[yb * mw + xa] * w01 + d[yb * mw + xb] * w11) / 255;
      if (needColor) { R[i] = G[i] = B[i] = l; }
    } else {
      const i00 = (ya * mw + xa) * 3, i10 = (ya * mw + xb) * 3, i01 = (yb * mw + xa) * 3, i11 = (yb * mw + xb) * 3;
      const r = (d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11) / 255;
      const g = (d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11) / 255;
      const bb = (d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11) / 255;
      l = 0.2126 * r + 0.7152 * g + 0.0722 * bb;
      if (needColor) { R[i] = r; G[i] = g; B[i] = bb; }
    }
    let ln = (l - mean) * k + 0.5;
    if (o.invert) ln = 1 - ln;
    lum[i] = ln;
  }
  if (needColor && (o.contrast || 0) !== 0) {
    const cf = 1 + (o.contrast / 100) * (o.contrast > 0 ? 1.5 : 0.9);
    for (let i = 0; i < n; i++) { R[i] = clamp01((R[i] - 0.5) * cf + 0.5); G[i] = clamp01((G[i] - 0.5) * cf + 0.5); B[i] = clamp01((B[i] - 0.5) * cf + 0.5); }
  }
  return { lum, r: R, g: G, b: B };
}
/** Modulation « relief » d'une couleur par la luminance d'une texture. */
function reliefMod(c, ln, amt) {
  const m = (ln - 0.5) * 2 * amt;
  return m > 0 ? c + (1 - c) * m * 0.75 : c * (1 + m * 0.85);
}

/* ---------- Composition couleur ---------------------------------------- */
function hexToRgb(hex) {
  let hx = String(hex || "#ffffff").replace("#", "").trim();
  if (hx.length === 3) hx = hx.split("").map(c => c + c).join("");
  const n = parseInt(hx, 16);
  if (isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function chromatic(img, w, h, off, ang) {
  const dx = Math.cos(ang) * off, dy = Math.sin(ang) * off, n = w * h;
  const R = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    R[i] = sample(img.r, w, h, x - dx, y - dy);
    B[i] = sample(img.b, w, h, x + dx, y + dy);
    A[i] = Math.max(img.a[i], sample(img.a, w, h, x - dx, y - dy), sample(img.a, w, h, x + dx, y + dy));
  }
  return { r: R, g: img.g, b: B, a: A };
}
function adjust(img, n, P) {
  const br = pc(P.brightness, 0), ct = pc(P.contrast, 0), sa = pc(P.saturation, 0);
  const hu = (P.hue || 0) * Math.PI / 180, op = pc(P.opacity, 100);
  const cf = ct >= 0 ? 1 + ct * 2.2 : 1 + ct;
  let m = null;
  if (Math.abs(hu) > 1e-4) {
    const C = Math.cos(hu), S = Math.sin(hu);
    m = [0.299 + 0.701 * C + 0.168 * S, 0.587 - 0.587 * C + 0.330 * S, 0.114 - 0.114 * C - 0.497 * S,
      0.299 - 0.299 * C - 0.328 * S, 0.587 + 0.413 * C + 0.035 * S, 0.114 - 0.114 * C + 0.292 * S,
      0.299 - 0.3 * C + 1.25 * S, 0.587 - 0.588 * C - 1.05 * S, 0.114 + 0.886 * C - 0.203 * S];
  }
  const R = img.r, G = img.g, B = img.b, A = img.a;
  for (let i = 0; i < n; i++) {
    let a = A[i];
    if (a <= 1e-5) { A[i] = 0; R[i] = G[i] = B[i] = 0; continue; }
    if (a > 1) a = 1;
    let r = R[i] / a, g = G[i] / a, b = B[i] / a;
    if (m) { const r2 = m[0] * r + m[1] * g + m[2] * b, g2 = m[3] * r + m[4] * g + m[5] * b, b2 = m[6] * r + m[7] * g + m[8] * b; r = r2; g = g2; b = b2; }
    if (sa !== 0) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, f = 1 + sa; r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f; }
    if (br > 0) { r += (1 - r) * br; g += (1 - g) * br; b += (1 - b) * br; }
    else if (br < 0) { r *= 1 + br; g *= 1 + br; b *= 1 + br; }
    if (ct !== 0) { r = (r - 0.5) * cf + 0.5; g = (g - 0.5) * cf + 0.5; b = (b - 0.5) * cf + 0.5; }
    r = clamp01(r); g = clamp01(g); b = clamp01(b);
    a *= op;
    R[i] = r * a; G[i] = g * a; B[i] = b * a; A[i] = a;
  }
}

function stageCompose(a, P, ctx, tex) {
  const { w, h, unit } = ctx; const n = w * h;
  const core = hexToRgb(P.core), edge = hexToRgb(P.edge), gc = hexToRgb(P.glowColor);
  const cmode = P.colorMode == null ? (P.bichromie > 0 ? 1 : 0) : (P.colorMode | 0);
  const bich = cmode === 1 ? pc(P.bichromie, 0) : 0;
  // Gradient map : densité (texte + halo) → dégradé extérieur → bord → intérieur → cœur
  let GM = null;
  if (cmode === 2) {
    const sp = pc(P.gmSpread, 30);
    const Gh = sp > 0 ? gauss(a, w, h, (0.02 + sp * 0.6) * unit) : null;
    const gamma = Math.pow(2, -(P.gmBias || 0) / 50);
    const fade = 0.04 + pc(P.gmFade, 30) * 0.6;
    const stops = [hexToRgb(P.gmOuter), hexToRgb(P.gmMid), hexToRgb(P.gmInner), core];
    const pst = pc(P.stipple, 0), cell = Math.max(0.5, (P.grainSize || 2) * ctx.pxScale), ss = ctx.seed + 707;
    GM = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) };
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      let d = a[i];
      if (Gh) d = d + (1 - d) * Math.min(1, Gh[i] * 1.5);
      if (pst > 0 && d > 0.002 && d < 0.998) {
        const t = hash2(Math.floor(x / cell), Math.floor(y / cell), ss);
        d = d + ((d > t ? 1 : 0) - d) * pst * 0.65;
      }
      const tt = Math.pow(clamp01(d), gamma) * 3;
      const k = Math.min(2, Math.floor(tt)), f = tt - k, c0 = stops[k], c1 = stops[k + 1];
      GM.r[i] = c0[0] + (c1[0] - c0[0]) * f; GM.g[i] = c0[1] + (c1[1] - c0[1]) * f; GM.b[i] = c0[2] + (c1[2] - c0[2]) * f;
      GM.a[i] = smoothstep(0, fade, d);
    }
  }
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  const gl = pc(P.glow, 0);
  const GL = gl > 0 ? gauss(a, w, h, (0.03 + pc(P.glowRadius, 30) * 0.9) * unit) : null;
  const grain = pc(P.grain, 0);
  const gcell = Math.max(0.5, (P.grainSize || 2) * ctx.pxScale), gs = ctx.seed + 808;
  // texture du texte
  const tAmt = pc(P.texAmount, 0), tMode = P.texMode | 0;
  const T = (tex && tAmt > 0) ? projectTexture(tex, ctx, { scale: P.texScale, angle: P.texAngle, x: P.texX, y: P.texY, contrast: P.texContrast, invert: P.texInvert }, tMode === 2) : null;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    let al = GM ? GM.a[i] : a[i];
    if (al <= 0 && !GL) continue;
    let cr = core[0], cg = core[1], cb = core[2];
    if (GM) { cr = GM.r[i]; cg = GM.g[i]; cb = GM.b[i]; }
    if (bich > 0 && al > 0) {
      const wg = (1 - bich) + bich * Math.pow(al, 2.2);
      cr = edge[0] + (core[0] - edge[0]) * wg; cg = edge[1] + (core[1] - edge[1]) * wg; cb = edge[2] + (core[2] - edge[2]) * wg;
    }
    if (T && al > 0) {
      const ln = T.lum[i];
      if (tMode === 0) { cr = reliefMod(cr, ln, tAmt); cg = reliefMod(cg, ln, tAmt); cb = reliefMod(cb, ln, tAmt); }
      else if (tMode === 1) { const thr = -0.15 + tAmt * 0.95; al *= clamp01((ln - thr) / 0.07 + 0.5); }
      else { cr += (T.r[i] - cr) * tAmt; cg += (T.g[i] - cg) * tAmt; cb += (T.b[i] - cb) * tAmt; }
    }
    if (grain > 0 && al > 0) {
      const nn = (hash2(Math.floor(x / gcell), Math.floor(y / gcell), gs) + hash2(Math.floor(x / gcell), Math.floor(y / gcell), gs + 1) + hash2(Math.floor(x / gcell), Math.floor(y / gcell), gs + 2)) / 3 - 0.5;
      const mm = 1 + nn * grain * 1.6; cr *= mm; cg *= mm; cb *= mm;
    }
    let pr = cr * al, pg = cg * al, pb = cb * al, pa = al;
    if (GL) {
      const ga = clamp01(GL[i] * gl * 2.2), k = ga * (1 - al);
      pr += gc[0] * k; pg += gc[1] * k; pb += gc[2] * k; pa = al + k;
    }
    R[i] = pr; G[i] = pg; B[i] = pb; A[i] = pa;
  }
  let img = { r: R, g: G, b: B, a: A };
  const ch = pc(P.chroma, 0);
  if (ch > 0) img = chromatic(img, w, h, ch * 0.12 * unit, -(P.chromaAngle || 0) * Math.PI / 180);
  adjust(img, n, P);
  return img;
}

/* ======================================================================= */
/*  API                                                                     */
/* ======================================================================= */
function makeCanvas(mask, mw, mh, pad, unit) {
  const w = mw + 2 * pad, h = mh + 2 * pad;
  const a = new Float32Array(w * h);
  for (let y = 0; y < mh; y++) a.set(mask.subarray(y * mw, y * mw + mw), (y + pad) * w + pad);
  return { a, w, h, ox: pad, oy: pad, tw: mw, th: mh, unit };
}

/**
 * Rendu complet.
 * cv  : { a, w, h, ox, oy, tw, th, unit }
 * opt : { cache, pxScale, texText }
 * Retour : { img: {r,g,b,a} prémultiplié, meta }
 */
function render(cv, P, opt) {
  opt = opt || {};
  const w = cv.w, h = cv.h, unit = Math.max(0.5, cv.unit);
  const seed = (P.seed | 0);
  const ctx = {
    w, h, unit, ox: cv.ox, oy: cv.oy, tw: cv.tw, th: cv.th,
    cx: cv.ox + cv.tw / 2, cy: cv.oy + cv.th / 2,
    ax: cv.ox + cv.tw / 2, ay: cv.oy + cv.th / 2,
    cache: opt.cache || null, pxScale: opt.pxScale || 1, seed, input: cv.a, meta: {},
    base: w + "x" + h + "|" + unit.toFixed(3) + "|" + cv.ox + "," + cv.oy + "|" + seed
  };
  let a = cv.a;
  a = stageGeom(a, P, ctx);
  if (hasGeom(P)) ctx.base += "|g" + [P.warpStyle, P.warpBend, P.perspH, P.perspV, P.skew, P.rotate, P.scaleX, P.scaleY].join(",");
  a = stageWarp(a, P, ctx);
  a = stageErode(a, P, ctx);
  a = stageInk(a, P, ctx);
  a = stageDestroy(a, P, ctx);
  a = stageBlur(a, P, ctx);
  a = stageStipple(a, P, ctx);
  const img = stageCompose(a, P, ctx, opt.texText || null);
  ctx.meta.box = { ox: ctx.ox, oy: ctx.oy, tw: ctx.tw, th: ctx.th };
  return { img, meta: ctx.meta };
}

/**
 * Fond (couleur + texture éventuelle) pour un canevas w×h.
 * o : { pxScale, ax, ay (ancre = centre du texte en px du canevas), texBg }
 * Retour : Float32Array RVB entrelacé (0..1).
 */
function renderBackground(w, h, P, o) {
  const n = w * h, out = new Float32Array(n * 3);
  const bg = hexToRgb(P.bg);
  const amt = pc(P.bgTexAmount, 0);
  let T = null;
  if (o.texBg && amt > 0) {
    T = projectTexture(o.texBg, { w, h, pxScale: o.pxScale || 1, ax: o.ax, ay: o.ay },
      { scale: P.bgTexScale, angle: P.bgTexAngle, x: P.bgTexX, y: P.bgTexY, contrast: P.bgTexContrast, invert: P.bgTexInvert }, (P.bgTexMode | 0) === 1);
  }
  for (let i = 0; i < n; i++) {
    let r = bg[0], g = bg[1], b = bg[2];
    if (T) {
      if ((P.bgTexMode | 0) === 1) { r += (T.r[i] - r) * amt; g += (T.g[i] - g) * amt; b += (T.b[i] - b) * amt; }
      else { const l = T.lum[i]; r = reliefMod(r, l, amt); g = reliefMod(g, l, amt); b = reliefMod(b, l, amt); }
    }
    out[i * 3] = clamp01(r); out[i * 3 + 1] = clamp01(g); out[i * 3 + 2] = clamp01(b);
  }
  return out;
}

function resizeMask(a, w, h, nw, nh) {
  const sx = w / nw, sy = h / nh;
  let src = a;
  const shrink = Math.max(sx, sy);
  if (shrink > 1.4) src = gauss(a, w, h, shrink * 0.42);
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const yy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < nw; x++) out[y * nw + x] = sample(src, w, h, (x + 0.5) * sx - 0.5, yy);
  }
  return out;
}
function scaleCanvas(cv, f) {
  const nw = Math.max(1, Math.round(cv.w * f)), nh = Math.max(1, Math.round(cv.h * f));
  return { a: resizeMask(cv.a, cv.w, cv.h, nw, nh), w: nw, h: nh, ox: cv.ox * f, oy: cv.oy * f, tw: cv.tw * f, th: cv.th * f, unit: cv.unit * f };
}
function resizeRGBA(img, w, h, nw, nh) {
  const sx = w / nw, sy = h / nh;
  const o = { r: new Float32Array(nw * nh), g: new Float32Array(nw * nh), b: new Float32Array(nw * nh), a: new Float32Array(nw * nh) };
  for (let y = 0, i = 0; y < nh; y++) {
    const yy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < nw; x++, i++) {
      const xx = (x + 0.5) * sx - 0.5;
      o.r[i] = sample(img.r, w, h, xx, yy); o.g[i] = sample(img.g, w, h, xx, yy);
      o.b[i] = sample(img.b, w, h, xx, yy); o.a[i] = sample(img.a, w, h, xx, yy);
    }
  }
  return o;
}

/** Composite sur fond → RVB 8 bits (aperçu). bg = { checker } | { color } | { rgb: Float32Array } */
function toRGB8(img, w, h, bg) {
  const out = new Uint8Array(w * h * 3);
  const cell = bg.cell || Math.max(6, Math.round(Math.max(w, h) / 50));
  const col = bg.color || [0, 0, 0];
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    let br, bgc, bb;
    if (bg.rgb) { br = bg.rgb[i * 3]; bgc = bg.rgb[i * 3 + 1]; bb = bg.rgb[i * 3 + 2]; }
    else if (bg.checker) { const c = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) ? 0.19 : 0.14; br = bgc = bb = c; }
    else { br = col[0]; bgc = col[1]; bb = col[2]; }
    const a = clamp01(img.a[i]), j = i * 3;
    out[j] = Math.round(clamp01(img.r[i] + br * (1 - a)) * 255);
    out[j + 1] = Math.round(clamp01(img.g[i] + bgc * (1 - a)) * 255);
    out[j + 2] = Math.round(clamp01(img.b[i] + bb * (1 - a)) * 255);
  }
  return out;
}

/** Réduction de qualité (moyenne de zone) d'une image RVB8 dans un cadre fixe. */
function fitRGB8(rgb, w, h, TW, TH, fill) {
  const out = new Uint8Array(TW * TH * 3);
  const f = [Math.round(fill[0] * 255), Math.round(fill[1] * 255), Math.round(fill[2] * 255)];
  const sc = Math.min(TW / w, TH / h);
  const dw = w * sc, dh = h * sc, ox = (TW - dw) / 2, oy = (TH - dh) / 2;
  const st = Math.max(1, Math.ceil(1 / sc));
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const j = (y * TW + x) * 3;
    const sx0 = (x - ox) / sc, sy0 = (y - oy) / sc;
    if (sx0 < 0 || sy0 < 0 || sx0 >= w || sy0 >= h) { out[j] = f[0]; out[j + 1] = f[1]; out[j + 2] = f[2]; continue; }
    let r = 0, g = 0, b = 0, c = 0;
    for (let yy = 0; yy < st; yy++) for (let xx = 0; xx < st; xx++) {
      const px = Math.min(w - 1, Math.floor(sx0 + xx * (1 / sc) / st)), py = Math.min(h - 1, Math.floor(sy0 + yy * (1 / sc) / st));
      const k = (py * w + px) * 3; r += rgb[k]; g += rgb[k + 1]; b += rgb[k + 2]; c++;
    }
    out[j] = r / c; out[j + 1] = g / c; out[j + 2] = b / c;
  }
  return out;
}

function toTyped(img, w, h, depth) {
  const n = w * h;
  let buf, max;
  if (depth === 16) { buf = new Uint16Array(n * 4); max = 32768; }
  else if (depth === 32) { buf = new Float32Array(n * 4); max = 1; }
  else { buf = new Uint8Array(n * 4); max = 255; }
  for (let i = 0; i < n; i++) {
    const a = clamp01(img.a[i]); let r = 0, g = 0, b = 0;
    if (a > 1e-4) { r = clamp01(img.r[i] / a); g = clamp01(img.g[i] / a); b = clamp01(img.b[i] / a); }
    const j = i * 4;
    if (depth === 32) { buf[j] = r; buf[j + 1] = g; buf[j + 2] = b; buf[j + 3] = a; }
    else { buf[j] = Math.round(r * max); buf[j + 1] = Math.round(g * max); buf[j + 2] = Math.round(b * max); buf[j + 3] = Math.round(a * max); }
  }
  return buf;
}
function rgbToTyped(rgb, w, h, depth) {
  const n = w * h;
  let buf, max;
  if (depth === 16) { buf = new Uint16Array(n * 4); max = 32768; }
  else if (depth === 32) { buf = new Float32Array(n * 4); max = 1; }
  else { buf = new Uint8Array(n * 4); max = 255; }
  for (let i = 0; i < n; i++) {
    const j = i * 4, k = i * 3;
    if (depth === 32) { buf[j] = rgb[k]; buf[j + 1] = rgb[k + 1]; buf[j + 2] = rgb[k + 2]; buf[j + 3] = 1; }
    else { buf[j] = Math.round(rgb[k] * max); buf[j + 1] = Math.round(rgb[k + 1] * max); buf[j + 2] = Math.round(rgb[k + 2] * max); buf[j + 3] = max; }
  }
  return buf;
}

module.exports = {
  render, renderBackground, computePad, geomExtent, makeCanvas, scaleCanvas, resizeMask, resizeRGBA,
  toRGB8, fitRGB8, toTyped, rgbToTyped, hexToRgb, prepareTexture, WARP_STYLES
};

window.InkEngine = module.exports;
})();
(function () {
var module = { exports: {} };
"use strict";
/* INK LAB 2 — paramètres, schéma de l'interface, templates et jeux de couleurs */

const DEFAULTS = {
  // Interrupteurs des sections (une section coupée n'agit plus sur le rendu)
  onColors: true, onGeom: false, onInk: false, onDestroy: false, onBlur: false, onGlow: false,
  onTex: false, onGrain: false, onAdjust: false, addBg: true,
  // Couleurs
  core: "#FFFFFF", edge: "#FF3B1F", glowColor: "#8B3DFF", bg: "#0A0A0A", bichromie: 0,
  colorMode: 0, gmOuter: "#3A0B5E", gmMid: "#FF5A1F", gmInner: "#FFB46A", gmSpread: 30, gmBias: 0, gmFade: 30,
  // Perspective & déformation
  warpStyle: "none", warpBend: 0, perspH: 0, perspV: 0, skew: 0, rotate: 0, scaleX: 100, scaleY: 100,
  // Ink bleed
  inkBleed: 0, inkStyle: 0, inkSpread: 0, inkRough: 40, inkGrain: 30, inkSharp: 85, speckles: 0, speckSize: 40, pores: 0,
  // Destruction
  destroyAngle: 0, streaks: 0, streakDensity: 40, streakWidth: 30, streakDir: 0, cuts: 0, cutWidth: 30,
  slices: 0, sliceCount: 8, sliceDensity: 50, warp: 0, warpSize: 40, erode: 0, erodeSize: 30,
  // Flou
  blurAngle: 0, blur: 0, motion: 0, progressive: 0, progType: 0, progStart: 30, progEnd: 100, fade: 0,
  // Glow & aberration
  glow: 0, glowRadius: 30, chroma: 0, chromaAngle: 0,
  // Texture du texte
  tex: "", texMode: 0, texAmount: 60, texScale: 100, texContrast: 0, texAngle: 0, texX: 0, texY: 0, texInvert: false,
  // Fond
  bgTex: "", bgTexMode: 0, bgTexAmount: 60, bgTexScale: 100, bgTexContrast: 0, bgTexAngle: 0, bgTexX: 0, bgTexY: 0, bgTexInvert: false,
  // Grain
  stipple: 0, grain: 0, grainSize: 2,
  // Lumière & couleur
  brightness: 0, contrast: 0, saturation: 0, hue: 0, opacity: 100,
  // Variation
  seed: 7
};

/* Valeurs « neutres » appliquées quand une section est coupée. */
const NEUTRAL = {
  onGeom: { warpStyle: "none", warpBend: 0, perspH: 0, perspV: 0, skew: 0, rotate: 0, scaleX: 100, scaleY: 100 },
  onInk: { inkBleed: 0, speckles: 0, pores: 0 },
  onDestroy: { streaks: 0, cuts: 0, slices: 0, warp: 0, erode: 0 },
  onBlur: { blur: 0, motion: 0, progressive: 0, fade: 0 },
  onGlow: { glow: 0, chroma: 0 },
  onTex: { tex: "" },
  onGrain: { stipple: 0, grain: 0 },
  onAdjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0, opacity: 100 }
};

/**
 * Paramètres réellement utilisés pour le rendu : les sections coupées sont neutralisées.
 * Couleurs coupées → le texte garde la couleur d'origine du calque (srcColor).
 */
function effective(P, srcColor) {
  const E = Object.assign({}, P);
  for (const k in NEUTRAL) if (P[k] === false) Object.assign(E, NEUTRAL[k]);
  if (P.onColors === false) { const c = srcColor || "#FFFFFF"; E.core = c; E.edge = c; E.bichromie = 0; E.colorMode = 0; }
  if (P.colorMode == null) E.colorMode = P.bichromie > 0 ? 1 : 0;
  if (!P.addBg) { E.addBg = false; }
  return E;
}
/** Allume les sections qui ont des réglages actifs (templates d'origine, templates v1…). */
function autoToggles(P) {
  for (const k in NEUTRAL) {
    const n = NEUTRAL[k];
    P[k] = Object.keys(n).some(x => String(P[x]) !== String(n[x]));
  }
  if (P.onColors === undefined) P.onColors = true;
  return P;
}

const QUICK_ANGLES = [0, 45, 90, -45, -90, 180];

const WARP_STYLES = [
  ["none", "Aucune"], ["arc", "Arc"], ["arcLower", "Arc inf."], ["arcUpper", "Arc sup."],
  ["arch", "Arche"], ["bulge", "Renflement"], ["flag", "Drapeau"], ["wave", "Onde"], ["fish", "Poisson"],
  ["rise", "Hausse"], ["fisheye", "Fisheye"], ["inflate", "Gonflement"], ["squeeze", "Compression"], ["twist", "Torsion"]
];

/* Sections dans l'ordre du traitement. type "group" = intertitre. */
const SCHEMA = [
  { id: "colors", title: "Couleurs", sub: "uni · bichromie · gradient map", toggle: "onColors", custom: "colors",
    offNote: "Section coupée : le texte garde sa couleur d'origine.", params: [
    { k: "colorMode", l: "Mode de couleur", type: "seg", inCustom: true, options: [["Uni", 0], ["Bichromie", 1], ["Gradient map", 2]] },
    { k: "bichromie", l: "Bichromie (part des bords)", min: 0, max: 100, u: "%", show: { colorMode: 1 } },
    { k: "gmSpread", l: "Étendue du dégradé (halo)", min: 0, max: 100, u: "%", show: { colorMode: 2 } },
    { k: "gmBias", l: "Équilibre (vers l'extérieur ↔ vers le cœur)", min: -100, max: 100, u: "", show: { colorMode: 2 } },
    { k: "gmFade", l: "Fondu de l'extérieur", min: 0, max: 100, u: "%", show: { colorMode: 2 } }
  ]},
  { id: "geom", title: "Perspective", sub: "déformation · inclinaison", toggle: "onGeom", custom: "geom", params: [
    { type: "group", l: "Courbure" },
    { k: "warpBend", l: "Inflexion", min: -100, max: 100, u: "%" },
    { type: "group", l: "Perspective et proportions" },
    { k: "perspH", l: "Perspective horizontale", min: -100, max: 100, u: "%" },
    { k: "perspV", l: "Perspective verticale", min: -100, max: 100, u: "%" },
    { k: "skew", l: "Inclinaison (italique)", min: -100, max: 100, u: "%" },
    { k: "rotate", l: "Rotation", min: -180, max: 180, u: "°", angle: true },
    { k: "scaleX", l: "Largeur", min: 30, max: 200, u: "%" },
    { k: "scaleY", l: "Hauteur", min: 30, max: 250, u: "%" }
  ]},
  { id: "ink", title: "Ink bleed", sub: "encre · éclaboussures · pores", toggle: "onInk", params: [
    { type: "group", l: "Bavure de l'encre" },
    { k: "inkStyle", l: "Style du bord", type: "seg", options: [["Net", 0], ["Toner (photocopie)", 1]] },
    { k: "inkBleed", l: "Bavure", min: 0, max: 100, u: "%" },
    { k: "inkSpread", l: "Étalement", min: -50, max: 100, u: "" },
    { k: "inkRough", l: "Irrégularité du bord", min: 0, max: 100, u: "%" },
    { k: "inkGrain", l: "Échelle des irrégularités", min: 1, max: 100, u: "" },
    { k: "inkSharp", l: "Netteté du bord (toner : largeur du tramé)", min: 0, max: 100, u: "%" },
    { type: "group", l: "Éclaboussures et manques" },
    { k: "speckles", l: "Éclaboussures", min: 0, max: 100, u: "%" },
    { k: "pores", l: "Manques / pores", min: 0, max: 100, u: "%" },
    { k: "speckSize", l: "Taille des points", min: 1, max: 100, u: "" }
  ]},
  { id: "destroy", title: "Destruction", sub: "éclats · entailles · tranches", toggle: "onDestroy", params: [
    { k: "destroyAngle", l: "Axe de destruction", min: -180, max: 180, u: "°", angle: true },
    { type: "group", l: "Éclats" },
    { k: "streaks", l: "Longueur", min: 0, max: 100, u: "%" },
    { k: "streakDensity", l: "Densité", min: 0, max: 100, u: "%" },
    { k: "streakWidth", l: "Épaisseur (fin = brosse, large = éclats)", min: 1, max: 100, u: "" },
    { k: "streakDir", l: "Sens", type: "seg", options: [["↔ Les deux", 0], ["→ Avant", 1], ["← Arrière", 2]] },
    { type: "group", l: "Entailles" },
    { k: "cuts", l: "Quantité", min: 0, max: 100, u: "%" },
    { k: "cutWidth", l: "Largeur", min: 1, max: 100, u: "" },
    { type: "group", l: "Tranches (glitch)" },
    { k: "slices", l: "Décalage", min: 0, max: 100, u: "%" },
    { k: "sliceCount", l: "Nombre par ligne", min: 1, max: 40, u: "" },
    { k: "sliceDensity", l: "Proportion touchée", min: 0, max: 100, u: "%" },
    { type: "group", l: "Distorsion et érosion" },
    { k: "warp", l: "Distorsion organique", min: 0, max: 100, u: "%" },
    { k: "warpSize", l: "Échelle de la distorsion", min: 1, max: 100, u: "" },
    { k: "erode", l: "Érosion des bords", min: 0, max: 100, u: "%" },
    { k: "erodeSize", l: "Échelle de l'érosion", min: 1, max: 100, u: "" }
  ]},
  { id: "blur", title: "Flou", sub: "gaussien · directionnel · progressif", toggle: "onBlur", params: [
    { k: "blurAngle", l: "Axe du flou", min: -180, max: 180, u: "°", angle: true },
    { type: "group", l: "Flou global" },
    { k: "blur", l: "Flou gaussien", min: 0, max: 100, u: "%" },
    { k: "motion", l: "Flou directionnel", min: 0, max: 100, u: "%" },
    { type: "group", l: "Flou progressif", hint: "Glisse les repères orange (début) et blanc (flou max) dans l'aperçu." },
    { k: "progType", l: "Type", type: "seg", options: [["Gaussien", 0], ["Directionnel (selon l'axe)", 1]] },
    { k: "progressive", l: "Intensité", min: 0, max: 100, u: "%" },
    { k: "progStart", l: "Début (0 = bord du texte)", min: -60, max: 160, u: "%" },
    { k: "progEnd", l: "Fin – flou maximal (100 = autre bord)", min: -60, max: 160, u: "%" },
    { k: "fade", l: "Fondu (transparence)", min: 0, max: 100, u: "%" }
  ]},
  { id: "glow", title: "Glow & aberration", sub: "halo · franges RVB", toggle: "onGlow", params: [
    { k: "glow", l: "Intensité du glow", min: 0, max: 100, u: "%" },
    { k: "glowRadius", l: "Rayon du glow", min: 1, max: 100, u: "" },
    { k: "chroma", l: "Aberration chromatique", min: 0, max: 100, u: "%" },
    { k: "chromaAngle", l: "Axe de l'aberration", min: -180, max: 180, u: "°", angle: true }
  ]},
  { id: "texture", title: "Texture du texte", sub: "papier · carton · béton · bois…", toggle: "onTex", custom: "texture", params: [] },
  { id: "grain", title: "Grain", sub: "pointillé · grain photo", toggle: "onGrain", params: [
    { k: "stipple", l: "Pointillé (bords tramés)", min: 0, max: 100, u: "%" },
    { k: "grain", l: "Grain photo", min: 0, max: 100, u: "%" },
    { k: "grainSize", l: "Taille du grain (px)", min: 1, max: 10, u: "px" }
  ]},
  { id: "adjust", title: "Lumière & couleur", sub: "luminosité · contraste · teinte", toggle: "onAdjust", params: [
    { k: "brightness", l: "Luminosité", min: -100, max: 100, u: "" },
    { k: "contrast", l: "Contraste", min: -100, max: 100, u: "" },
    { k: "saturation", l: "Saturation", min: -100, max: 100, u: "" },
    { k: "hue", l: "Teinte", min: -180, max: 180, u: "°" },
    { k: "opacity", l: "Opacité", min: 0, max: 100, u: "%" }
  ]},
  { id: "bg", title: "Fond", sub: "couleur · texture du fond", toggle: "addBg", custom: "bg",
    offNote: "Section coupée : aucun calque de fond, rendu sur transparence.", params: [] },
  { id: "output", title: "Sortie", sub: "objet dynamique · calques", custom: "output", params: [] }
];

/* Paramètres de texture */
const TEX_PARAMS = {
  text: [
    { k: "texMode", l: "Mode", type: "seg", options: [["Relief", 0], ["Usure", 1], ["Couleur", 2]] },
    { k: "texAmount", l: "Intensité", min: 0, max: 100, u: "%" },
    { k: "texScale", l: "Échelle", min: 10, max: 400, u: "%" },
    { k: "texContrast", l: "Contraste", min: -100, max: 100, u: "" },
    { k: "texAngle", l: "Rotation", min: -180, max: 180, u: "°" },
    { k: "texX", l: "Position X", min: -100, max: 100, u: "" },
    { k: "texY", l: "Position Y", min: -100, max: 100, u: "" }
  ],
  bg: [
    { k: "bgTexMode", l: "Mode", type: "seg", options: [["Relief teinté", 0], ["Couleurs d'origine", 1]] },
    { k: "bgTexAmount", l: "Intensité", min: 0, max: 100, u: "%" },
    { k: "bgTexScale", l: "Échelle", min: 10, max: 400, u: "%" },
    { k: "bgTexContrast", l: "Contraste", min: -100, max: 100, u: "" },
    { k: "bgTexAngle", l: "Rotation", min: -180, max: 180, u: "°" },
    { k: "bgTexX", l: "Position X", min: -100, max: 100, u: "" },
    { k: "bgTexY", l: "Position Y", min: -100, max: 100, u: "" }
  ]
};

/* Couleurs éditables dans la section Couleurs (le fond a sa propre section). */
const COLOR_KEYS = [
  ["core", "Texte / cœur"],
  ["edge", "Bords"],
  ["glowColor", "Glow"]
];

const GRADIENTS = [
  { name: "Feu", gmOuter: "#3D0000", gmMid: "#E01B12", gmInner: "#FF8A4C", core: "#FFE3B8" },
  { name: "Rétro", gmOuter: "#3A0B5E", gmMid: "#FF5A1F", gmInner: "#FFB46A", core: "#FFF3DE" },
  { name: "Néon", gmOuter: "#140033", gmMid: "#FF2BD6", gmInner: "#00E5FF", core: "#FFFFFF" },
  { name: "Glace", gmOuter: "#04122E", gmMid: "#1F6BFF", gmInner: "#8FD3FF", core: "#FFFFFF" },
  { name: "Toxique", gmOuter: "#001A0A", gmMid: "#00B347", gmInner: "#C8FF3A", core: "#F8FFE0" },
  { name: "Or", gmOuter: "#2A1300", gmMid: "#B5651D", gmInner: "#F2C14E", core: "#FFF6D8" }
];

const PALETTES = [
  { name: "Craie", core: "#F2EFE9", edge: "#9C9890", glowColor: "#FFFFFF", bg: "#0B0B0B" },
  { name: "Brasier", core: "#FFE2B8", edge: "#FF2A1A", glowColor: "#FF5A00", bg: "#070606" },
  { name: "Néon", core: "#FFFFFF", edge: "#00E5FF", glowColor: "#FF2BD6", bg: "#06060F" },
  { name: "Encre", core: "#111111", edge: "#3A3A3A", glowColor: "#000000", bg: "#ECE9E2" },
  { name: "Toxique", core: "#E8FF3A", edge: "#1BFF8A", glowColor: "#00FF66", bg: "#0A0F0A" },
  { name: "Rétro", core: "#FFF3DC", edge: "#FF7A2E", glowColor: "#6B1FB8", bg: "#0B0A0A" },
  { name: "Signal", core: "#FFD400", edge: "#FF6A00", glowColor: "#FFB000", bg: "#000000" },
  { name: "Rouge plein", core: "#120A0A", edge: "#3A0000", glowColor: "#FF0000", bg: "#FF1010" },
  { name: "Glacier", core: "#EAF6FF", edge: "#4FA3FF", glowColor: "#2B5BFF", bg: "#04070D" },
  { name: "Orange vif", core: "#FF5A00", edge: "#FF2A00", glowColor: "#FF8A00", bg: "#141414" },
  { name: "Papier", core: "#1A1A1A", edge: "#4A3F35", glowColor: "#2A2A2A", bg: "#F1F0EC" },
  { name: "Mono inversé", core: "#000000", edge: "#555555", glowColor: "#000000", bg: "#FFFFFF" }
];

function T(id, name, tag, o) {
  return { id: "builtin3-" + id, name, tag, builtin: true, params: autoToggles(Object.assign({}, DEFAULTS, o)) };
}

/* Templates d'origine : les 8 premiers reproduisent les références de départ. */
const BUILTIN = [
  T("eclats", "Éclats", "Destruction", {
    core: "#DCDBD6", bg: "#1A1A1B", destroyAngle: -16, streaks: 32, streakDensity: 26, streakWidth: 28,
    cuts: 14, cutWidth: 10, slices: 6, sliceCount: 3, sliceDensity: 22, grain: 10, seed: 21
  }),
  T("distordu", "Distorsion orange", "Perspective", {
    core: "#FF5A1F", bg: "#141414", addBg: false, warp: 34, warpSize: 100, warpStyle: "wave", warpBend: 30, skew: -12, rotate: -6, seed: 9
  }),
  T("fuite", "Fuite latérale", "Flou", {
    core: "#FFFFFF", bg: "#050505", progressive: 34, progType: 0, progStart: 40, progEnd: 104, blurAngle: 0, motion: 3, blur: 1
  }),
  T("glow", "Glow rétro", "Glow", {
    core: "#FFF3DE", colorMode: 2, gmOuter: "#2A0848", gmMid: "#FF7A3A", gmInner: "#FFC98A", gmSpread: 6, gmBias: 55, gmFade: 45,
    bg: "#0C0B0B", blur: 2.5, grain: 26, grainSize: 2, stipple: 0, bgTex: "rayures", bgTexMode: 0, bgTexAmount: 30
  }),
  T("fusion", "Fusion verticale", "Flou", {
    core: "#FFC891", colorMode: 2, gmOuter: "#7A0000", gmMid: "#F01E14", gmInner: "#FF9A5A", gmSpread: 5, gmBias: -45, gmFade: 30,
    bg: "#000000", scaleY: 118, scaleX: 92, blur: 3, motion: 10, blurAngle: 90, stipple: 45, grainSize: 2
  }),
  T("brume", "Brume rouge", "Flou", {
    core: "#170606", bg: "#FF1A0A", progressive: 100, progType: 0, blurAngle: -90, progStart: 22, progEnd: 135, blur: 3, fade: 6
  }),
  T("brosse", "Brosse sèche", "Destruction", {
    core: "#FFD400", bg: "#000000", destroyAngle: 76, streaks: 16, streakDensity: 20, streakWidth: 5, erode: 42, erodeSize: 6,
    tex: "rayures", texMode: 1, texAmount: 34, slices: 6, sliceCount: 2, sliceDensity: 30, seed: 33
  }),
  T("photocopie", "Encre photocopie", "Ink bleed", {
    core: "#0D0D0D", bg: "#D6D5D3", inkBleed: 32, inkStyle: 1, inkSpread: 18, inkRough: 22, inkGrain: 40, inkSharp: 8,
    speckles: 14, speckSize: 10, grain: 20, bgTex: "poussiere", bgTexMode: 0, bgTexAmount: 35, bgTexContrast: 0
  }),
  T("neon", "Néon spectral", "Glow", {
    core: "#FFFFFF", colorMode: 2, gmOuter: "#140033", gmMid: "#FF2BD6", gmInner: "#00E5FF", gmSpread: 45, gmFade: 25,
    bg: "#050510", chroma: 30, blur: 2
  }),
  T("tampon", "Tampon carton", "Texture", {
    core: "#1C1A19", bg: "#B78A5A", inkBleed: 14, inkRough: 35, inkSharp: 95, tex: "carton-encre", texMode: 1, texAmount: 38,
    bgTex: "carton-brut", bgTexMode: 1, bgTexAmount: 100, rotate: -4, opacity: 92
  }),
  T("glitch", "Glitch net", "Destruction", {
    core: "#F4F4F4", bg: "#0A0A0A", slices: 30, sliceCount: 9, sliceDensity: 38, cuts: 12, cutWidth: 12, chroma: 28, seed: 12
  }),
  T("arche", "Arche rétro", "Perspective", {
    core: "#F5E6C8", edge: "#E2572B", colorMode: 1, bg: "#1F3B2E", warpStyle: "arch", warpBend: 38, bichromie: 25, grain: 22,
    bgTex: "papier-kraft", bgTexMode: 0, bgTexAmount: 45
  }),
  T("sol", "Fuite au sol", "Perspective", {
    core: "#FFE81F", bg: "#000000", perspV: 62, scaleY: 85, fade: 55, progStart: -10, progEnd: 110, blurAngle: 90
  })
];

module.exports = { GRADIENTS, DEFAULTS, NEUTRAL, SCHEMA, TEX_PARAMS, COLOR_KEYS, PALETTES, BUILTIN, QUICK_ANGLES, WARP_STYLES, effective, autoToggles };

window.InkPresets = module.exports;
})();
