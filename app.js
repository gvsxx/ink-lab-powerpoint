"use strict";
/* ==========================================================================
   INK LAB — version navigateur (page web + complément PowerPoint)
   Ce fichier est assemblé par build.py : en-tête + panneau commun (repris du
   plugin Photoshop) + adaptations navigateur. L'hôte (web ou PowerPoint) est
   fourni par window.HOST (host-web.js ou host-ppt.js).
   ========================================================================== */
const E = window.InkEngine;
const PR = window.InkPresets;
const HOST = window.HOST || {};

/* Remplace l'encodeur PNG du plugin Photoshop par le canvas du navigateur. */
function rgbToCanvas(rgb, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"), id = x.createImageData(w, h), d = id.data;
  for (let i = 0, j = 0; i < w * h; i++, j += 3) { d[i * 4] = rgb[j]; d[i * 4 + 1] = rgb[j + 1]; d[i * 4 + 2] = rgb[j + 2]; d[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  return c;
}
const PNG = {
  encodePNG: (rgb, w, h) => ({ rgb, w, h }),
  base64: o => rgbToCanvas(o.rgb, o.w, o.h).toDataURL("image/png").split(",")[1]
};

/* ===== Panneau commun (extrait du plugin Photoshop) ===== */
const PREVIEW_SRC_MAX = 2000;      // résolution max de lecture du calque pour l'aperçu
const DRAFT_MAX = 560;             // aperçu rapide pendant les réglages
const HQ_MAX = 1600;               // aperçu haute définition au repos
const HQ_DELAY = 260;
const THUMB_W = 240, THUMB_H = 96;
const APPLY_MAX_PIXELS = 30e6;
const FX_PREFIX = "INK LAB · ";
const DATA_NAME = "⚙ INK LAB · réglages (ne pas supprimer)";
const PV_HEIGHTS = { S: 170, M: 240, L: 340, XL: 460 };

const S = {
  params: Object.assign({}, PR.DEFAULTS),
  templates: [], currentId: null, filter: "Tous",
  src: null, ctx: { mode: "none" },
  pvBg: "auto", pvSize: "M", compare: false,
  ui: { hideText: true, replace: true, output: "so", closeAfter: true, texCat: { text: "Tout", bg: "Tout" } },
  collapsed: {},
  cache: new Map(), thumbNoise: new Map(), thumbCache: new Map(), maskCache: new Map(),
  texLib: [], userTex: [], texCache: new Map(), texLoading: new Map(),
  busy: false, pending: null, applying: false, lastPv: null, drag: null,
  sample: null, thumbStore: {}
};

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => "u" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const num = v => (typeof v === "number" ? v : (v && v._value != null ? v._value : Number(v)));
const ALL_PARAMS = [];
PR.SCHEMA.forEach(sec => sec.params.forEach(p => ALL_PARAMS.push(p)));
PR.TEX_PARAMS.text.concat(PR.TEX_PARAMS.bg).forEach(p => ALL_PARAMS.push(p));
const PARAM_BY_KEY = {}; ALL_PARAMS.forEach(p => { if (p.k) PARAM_BY_KEY[p.k] = p; });
/* clé de paramètre → interrupteur de sa section */
const KEY_TOGGLE = {};
PR.SCHEMA.forEach(sec => { if (sec.toggle) sec.params.forEach(p => { if (p.k) KEY_TOGGLE[p.k] = sec.toggle; }); });
["core", "edge", "glowColor", "bichromie", "colorMode", "gmOuter", "gmMid", "gmInner", "gmSpread", "gmBias", "gmFade"].forEach(k => { KEY_TOGGLE[k] = "onColors"; });
Object.keys(PR.DEFAULTS).forEach(k => { if (/^tex/.test(k)) KEY_TOGGLE[k] = "onTex"; if (/^bgTex/.test(k) || k === "bg") KEY_TOGGLE[k] = "addBg"; });
["progStart", "progEnd"].forEach(k => { KEY_TOGGLE[k] = "onBlur"; });
const TOGGLES = PR.SCHEMA.filter(s => s.toggle).map(s => s.toggle);
const eff = P => PR.effective(P, S.src && S.src.color);

/* ---------- Stockage local ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("inklab." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("inklab." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
};
let stateTimer = null;
function status(msg, kind) { const el = $("status"); el.textContent = msg; el.className = kind || ""; if (kind === "err") logOp(msg, "err"); }
/* Journal des opérations (affiché dans « Sortie ») : aide à diagnostiquer un blocage. */
const OPLOG = [];
function logOp(msg, kind) {
  const d = new Date(), t = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
  OPLOG.push({ t, msg: String(msg), kind: kind || "" }); if (OPLOG.length > 40) OPLOG.shift();
  const el = document.getElementById("opLog");
  if (el) el.innerHTML = OPLOG.slice().reverse().map(o => `<div class="logLine ${o.kind}">${o.t} · ${esc(o.msg)}</div>`).join("");
}

/* ======================================================================= */
/*  TEMPLATES                                                               */
/* ======================================================================= */
function normalizeTpl(t) {
  const raw = t.params || {};
  let params = Object.assign({}, PR.DEFAULTS, raw);
  if (raw.onGeom === undefined) params = PR.autoToggles(params);
  return { id: t.id || uid(), name: t.name || "Sans nom", tag: t.tag || "Perso", builtin: !!t.builtin, params };
}
const currentTpl = () => S.templates.find(t => t.id === S.currentId) || null;
function isDirty() {
  const t = currentTpl(); if (!t) return true;
  for (const k of Object.keys(PR.DEFAULTS)) if (String(t.params[k]) !== String(S.params[k])) return true;
  return false;
}
function updateDirty() { $("dirtyBadge").className = "badge" + (currentTpl() && isDirty() ? " on" : ""); }
function tagsList() { const tags = ["Tous"]; S.templates.forEach(t => { if (tags.indexOf(t.tag) < 0) tags.push(t.tag); }); return tags; }
function renderFilter() {
  const tags = tagsList();
  if (tags.indexOf(S.filter) < 0) S.filter = "Tous";
  $("tplFilter").innerHTML = tags.map((t, i) => `<div class="fBtn${t === S.filter ? " on" : ""}" id="flt-${i}">${esc(t)}</div>`).join("");
  tags.forEach((t, i) => $("flt-" + i).addEventListener("click", () => { S.filter = t; renderFilter(); renderTemplateGrid(); saveState(); }));
}
function renderTemplateGrid() {
  const list = S.templates.filter(t => S.filter === "Tous" || t.tag === S.filter);
  $("tplCount").textContent = S.templates.length + " templates";
  $("tplGrid").innerHTML = list.map(t => {
    const p = t.params;
    return `<div class="tpl${t.id === S.currentId ? " on" : ""}" id="tpl-${t.id}">
      <div class="tplThumb"><div class="tplFallback" style="background-color:${p.addBg ? p.bg : "#1b1b1e"};color:${p.core}">Aa</div><img class="tplImg" id="thi-${t.id}" /></div>
      <div class="tplMeta" title="${esc(t.tag)}"><span class="tplName">${esc(t.name)}</span></div></div>`;
  }).join("");
  list.forEach(t => $("tpl-" + t.id).addEventListener("click", () => selectTemplate(t.id)));
  scheduleThumbs();
}
function selectTemplate(id) {
  const t = S.templates.find(x => x.id === id); if (!t) return;
  if (zeroUndo) { zeroUndo = null; clearTimeout(zeroTimer); setZeroBtn(false); }
  S.currentId = id;
  S.params = Object.assign({}, PR.DEFAULTS, clone(t.params));
  $("tplName").value = t.name;
  document.querySelectorAll(".tpl").forEach(el => el.classList.remove("on"));
  const el = $("tpl-" + id); if (el) el.classList.add("on");
  syncAll(); updateDirty(); scheduleRender(); saveState();
  status("Template « " + t.name + " » chargé.");
}
/* Vignettes : rendues sur « LOREM / IPSUM » (indépendantes du calque), mémorisées entre les sessions. */
let thumbJob = 0, thumbSaveTimer = null;
function thumbKey(t) { return "v2|" + JSON.stringify(PR.effective(t.params, "#F2F2F2")); }
function scheduleThumbs() {
  const job = ++thumbJob;
  if (!S.sample) return;
  const list = S.templates.filter(t => S.filter === "Tous" || t.tag === S.filter);
  let i = 0;
  const step = async () => {
    if (job !== thumbJob || i >= list.length) return;
    if (S.busy || S.applying) { setTimeout(step, 150); return; }
    const t = list[i++];
    try { await renderThumb(t); } catch (e) { console.log("thumb", e); }
    setTimeout(step, 10);
  };
  setTimeout(step, 200);
}
async function renderThumb(t) {
  const key = thumbKey(t);
  let b64 = S.thumbStore[key];
  if (!b64) {
    const P = PR.effective(t.params, "#F2F2F2");
    const texText = P.tex ? await getTexture(P.tex, true) : null, texBg = P.addBg && P.bgTex ? await getTexture(P.bgTex, true) : null;
    const r = renderAt(P, 420, S.thumbNoise, texText, S.sample);
    const bg = P.addBg ? { rgb: E.renderBackground(r.w, r.h, P, { pxScale: r.pxScale, ax: r.ax, ay: r.ay, texBg }) } : { color: [0.106, 0.106, 0.118] };
    const rgb = E.toRGB8(r.img, r.w, r.h, bg);
    const fill = P.addBg ? E.hexToRgb(P.bg) : [0.106, 0.106, 0.118];
    const fit = E.fitRGB8(rgb, r.w, r.h, THUMB_W, THUMB_H, fill);
    b64 = PNG.base64(PNG.encodePNG(fit, THUMB_W, THUMB_H, 6));
    S.thumbStore[key] = b64;
    clearTimeout(thumbSaveTimer); thumbSaveTimer = setTimeout(saveThumbStore, 1500);
  }
  const img = $("thi-" + t.id);
  if (img) { img.src = "data:image/png;base64," + b64; img.style.display = "block"; }
}
function uniqueName(base) { let n = base, i = 2; while (S.templates.some(t => t.name === n)) n = base + " " + (i++); return n; }
async function tplSave() {
  const t = currentTpl(); if (!t) return tplNew();
  t.name = $("tplName").value.trim() || t.name; t.params = clone(S.params);
  await saveTemplates(); renderFilter(); renderTemplateGrid(); updateDirty();
  status("Template « " + t.name + " » enregistré.", "ok");
}
async function tplNew() {
  const typed = $("tplName").value.trim(), cur = currentTpl();
  const name = uniqueName(typed && (!cur || typed !== cur.name) ? typed : (cur ? cur.name : "Mon template"));
  const t = { id: uid(), name, tag: "Perso", builtin: false, params: clone(S.params) };
  S.templates.push(t); S.currentId = t.id; $("tplName").value = name;
  await saveTemplates(); renderFilter(); renderTemplateGrid(); updateDirty(); saveState();
  status("Nouveau template « " + name + " » créé.", "ok");
}
async function tplDup() {
  const cur = currentTpl(); if (!cur) return;
  const t = { id: uid(), name: uniqueName(cur.name + " copie"), tag: "Perso", builtin: false, params: clone(cur.params) };
  S.templates.splice(S.templates.indexOf(cur) + 1, 0, t);
  await saveTemplates(); renderFilter(); renderTemplateGrid(); selectTemplate(t.id);
}
let delArmed = null;
async function tplDel() {
  const cur = currentTpl(); if (!cur) return;
  const btn = $("tplDel");
  if (delArmed !== cur.id) {
    delArmed = cur.id; btn.classList.add("armed"); btn.textContent = "Confirmer ?";
    setTimeout(() => { delArmed = null; btn.classList.remove("armed"); btn.textContent = "Supprimer"; }, 3000);
    return;
  }
  delArmed = null; btn.classList.remove("armed"); btn.textContent = "Supprimer";
  if (S.templates.length <= 1) { status("Il faut garder au moins un template.", "err"); return; }
  const idx = S.templates.indexOf(cur); S.templates.splice(idx, 1);
  await saveTemplates(); renderFilter();
  const next = S.templates[Math.min(idx, S.templates.length - 1)];
  S.currentId = next.id; renderTemplateGrid(); selectTemplate(next.id);
  status("Template « " + cur.name + " » supprimé.", "ok");
}
function tplRevert() { const cur = currentTpl(); if (cur) selectTemplate(cur.id); else resetAll(); }

/* Tout réinitialiser : texte brut (couleur d'origine), toutes les sections coupées, sans fond. */
let zeroUndo = null, zeroTimer = null;
function blankParams() {
  const P = Object.assign({}, PR.DEFAULTS, { onColors: false, addBg: false });
  Object.keys(PR.NEUTRAL).forEach(k => { P[k] = false; });
  return P;
}
function setZeroBtn(undo) {
  const b = $("btnZero");
  b.textContent = undo ? "↶ Annuler" : "Tout réinitialiser";
  b.className = "hdrBtn" + (undo ? " undo" : "");
}
function resetAll() {
  if (zeroUndo) {                       // second clic dans les 6 s : on annule
    S.params = zeroUndo.params; S.currentId = zeroUndo.currentId; zeroUndo = null; clearTimeout(zeroTimer);
    $("tplName").value = currentTpl() ? currentTpl().name : "";
    afterBulkChange(); setZeroBtn(false);
    status("Remise à zéro annulée.");
    return;
  }
  zeroUndo = { params: clone(S.params), currentId: S.currentId };
  S.params = blankParams(); S.currentId = null; $("tplName").value = "";
  // tout le reste aussi : mode Avant, filtres, poignée en cours
  if (S.compare) { S.compare = false; $("btnCompare").textContent = "Avant"; $("pvBadge").style.display = "none"; }
  S.drag = null; S.filter = "Tous"; S.ui.texCat = { text: "Tout", bg: "Tout" };
  renderFilter(); renderTemplateGrid();
  afterBulkChange(); setZeroBtn(true);
  status("Tout est remis à zéro : choisis un template ou active une section. (« Annuler » pendant 6 s)", "ok");
  clearTimeout(zeroTimer);
  zeroTimer = setTimeout(() => { zeroUndo = null; setZeroBtn(false); }, 6000);
}
function afterBulkChange() {
  document.querySelectorAll(".tpl").forEach(el => el.classList.remove("on"));
  const el = S.currentId && $("tpl-" + S.currentId); if (el) el.classList.add("on");
  syncAll(); updateDirty(); scheduleRender(); saveState();
}
let restoreArmed = false;
async function tplRestore() {
  const btn = $("tplRestore");
  if (!restoreArmed) { restoreArmed = true; btn.textContent = "Confirmer ?"; setTimeout(() => { restoreArmed = false; btn.textContent = "Originaux"; }, 3000); return; }
  restoreArmed = false; btn.textContent = "Originaux";
  PR.BUILTIN.forEach(b => {
    const idx = S.templates.findIndex(t => t.id === b.id), fresh = normalizeTpl(clone(b));
    if (idx >= 0) S.templates[idx] = fresh; else S.templates.push(fresh);
  });
  await saveTemplates(); renderFilter(); renderTemplateGrid();
  if (currentTpl()) selectTemplate(S.currentId);
  status("Templates d'origine restaurés (tes templates sont conservés).", "ok");
}

/* ======================================================================= */
/*  TEXTURES                                                                */
/* ======================================================================= */
const allTextures = () => S.texLib.concat(S.userTex);
const texById = id => allTextures().find(t => t.id === id) || null;

/** Renvoie la texture décodée (mise en cache) ou null. */

/* ======================================================================= */
/*  INTERFACE DES PARAMÈTRES                                               */
/* ======================================================================= */
function fmt(p, v) { return (Math.round(Number(v) * 10) / 10) + (p.u || ""); }
function sliderHTML(p) {
  const quick = p.angle ? `<div class="quick">${PR.QUICK_ANGLES.map((v, i) => `<div class="qBtn" id="q-${p.k}-${i}">${v}°</div>`).join("")}</div>` : "";
  return `<div class="row" id="row-${p.k}">
    <div class="rowTop"><span class="lbl" id="lbl-${p.k}" title="Double-clic : valeur du template">${p.l}</span><input class="val" id="val-${p.k}" type="text" /></div>
    <input type="range" class="rng" id="sl-${p.k}" title="Double-clic : valeur par défaut" min="${p.min}" max="${p.max}" step="${p.step || 1}" value="${S.params[p.k]}" />
    ${quick}${p.hint ? `<div class="hint">${p.hint}</div>` : ""}</div>`;
}
function paramHTML(p) {
  if (p.type === "group") return `<div class="grp">${p.l}</div>${p.hint ? `<div class="hint">${p.hint}</div>` : ""}`;
  if (p.type === "seg") {
    return `<div class="row" id="row-${p.k}"><div class="rowTop"><span class="lbl">${p.l}</span></div>
      <div class="seg">${p.options.map(o => `<div class="segBtn" id="seg-${p.k}-${o[1]}">${o[0]}</div>`).join("")}</div></div>`;
  }
  return sliderHTML(p);
}
function colorsHTML() {
  const pals = PR.PALETTES.map((p, i) => `<div class="palItem" id="pal-${i}" title="${esc(p.name)}">
      <div class="pal"><div class="palSw" style="background-color:${p.bg}"></div><div class="palSw" style="background-color:${p.core}"></div><div class="palSw" style="background-color:${p.edge}"></div><div class="palSw" style="background-color:${p.glowColor}"></div></div>
      <div class="palName">${esc(p.name)}</div></div>`).join("");
  const grads = PR.GRADIENTS.map((g, i) => `<div class="palItem" id="grd-${i}" title="${esc(g.name)}">
      <div class="pal"><div class="palSw" style="background-color:${g.gmOuter}"></div><div class="palSw" style="background-color:${g.gmMid}"></div><div class="palSw" style="background-color:${g.gmInner}"></div><div class="palSw" style="background-color:${g.core}"></div></div>
      <div class="palName">${esc(g.name)}</div></div>`).join("");
  const sw = (k, l) => `<div class="sw" id="swb-${k}">
      <div class="swColor" id="sw-${k}" title="Choisir une couleur"></div>
      <div class="swMeta"><div class="swLbl">${l}</div><input class="hex" id="hex-${k}" type="text" /></div></div>`;
  return `${paramHTML(PARAM_BY_KEY.colorMode)}
    <div id="palBlock"><div class="lbl" style="margin-top:8px">Jeux de couleurs</div><div class="palWrap">${pals}</div></div>
    <div id="gmBlock"><div class="lbl" style="margin-top:8px">Dégradés prêts à l'emploi</div><div class="palWrap">${grads}</div>
      <div class="gradBar" id="gradBar"></div>
      <div class="swWrap">${sw("gmOuter", "Extérieur (halo)")}${sw("gmMid", "Bord")}${sw("gmInner", "Intérieur")}${sw("core", "Cœur")}</div></div>
    <div class="swWrap" id="swPlain">${sw("coreP", "Texte / cœur")}${sw("edge", "Bords")}${sw("glowColor", "Glow")}</div>
    <div class="btnRow"><div class="btn mini" id="btnSwap">⇅ Inverser texte / fond</div><div class="btn mini" id="btnSwapEdge">⇄ Cœur / bords</div></div>`;
}
function geomHTML() {
  return `<div class="lbl" style="margin-top:2px">Style de déformation</div>
    <div class="styleGrid">${PR.WARP_STYLES.map(([k, l]) => `<div class="stBtn" id="ws-${k}">${l}</div>`).join("")}</div>
    <div class="btnRow"><div class="btn mini ghost" id="btnGeomReset">Remettre à plat</div></div>`;
}
function texPickerHTML(target) {
  const inv = target === "bg" ? "bgTexInvert" : "texInvert";
  return `<div class="texCats" id="tp-${target}-cats"></div>
    <div class="texGrid" id="tp-${target}-grid"></div>
    <div class="texInfo" id="tp-${target}-info"></div>
    <div class="btnRow">
      <div class="btn mini" id="tp-${target}-import">+ Importer une texture…</div>
      <div class="btn mini ghost" id="tp-${target}-random" title="Nouvelle position aléatoire dans la texture">⟳ Position</div>
      <div class="btn mini danger" id="tp-${target}-del" style="display:none">Supprimer</div>
    </div>
    <div id="tp-${target}-params">${PR.TEX_PARAMS[target].map(paramHTML).join("")}</div>
    <div class="ckRow"><label class="ck"><input type="checkbox" id="ck-${inv}" /> Inverser la texture</label></div>`;
}
function bgHTML() {
  return `<div class="sw solo"><div class="swColor" id="sw-bg" title="Choisir une couleur"></div>
      <div class="swMeta"><div class="swLbl">Couleur du fond</div><input class="hex" id="hex-bg" type="text" /></div></div>
    <div class="grp">Texture du fond</div>${texPickerHTML("bg")}
    <div class="note">Le fond est créé sous le rendu, à la taille du plan de travail (ou du document).</div>`;
}
function buildSections() {
  let html = "";
  PR.SCHEMA.forEach((sec, idx) => {
    const closed = S.collapsed[sec.id];
    const resettable = sec.params.length || sec.custom === "texture" || sec.custom === "geom" || sec.custom === "bg";
    html += `<div class="sec${closed ? " closed" : ""}" id="sec-${sec.id}">
      <div class="secHead" id="head-${sec.id}">
        <span class="chev" id="chev-${sec.id}">${closed ? "▸" : "▾"}</span><span class="secNum">${String(idx + 2).padStart(2, "0")}</span>
        <span class="secTitle">${sec.title.toUpperCase()}</span><span class="secSub">${sec.sub || ""}</span>
        ${resettable ? `<span class="secReset" id="reset-${sec.id}" title="Remettre cette section aux valeurs du template">↺</span>` : ""}
        ${sec.toggle ? `<div class="tg" id="tg-${sec.id}" title="Activer / désactiver cette section"><div class="kn"></div></div>` : ""}
      </div>
      <div class="secBody">
        ${sec.toggle ? `<div class="offNote">${sec.offNote || "Section coupée : sans effet sur le rendu. Touche un réglage pour la réactiver."}</div>` : ""}
        ${sec.custom === "colors" ? colorsHTML() : ""}${sec.custom === "geom" ? geomHTML() : ""}${sec.custom === "texture" ? texPickerHTML("text") : ""}${sec.custom === "bg" ? bgHTML() : ""}
        ${sec.params.filter(p => !p.inCustom).map(paramHTML).join("")}${sec.custom === "output" ? outputHTML() : ""}
      </div></div>`;
  });
  $("sections").innerHTML = html;
}
function toggleSection(id) {
  S.collapsed[id] = !S.collapsed[id];
  const el = $("sec-" + id); if (!el) return;
  if (S.collapsed[id]) el.classList.add("closed"); else el.classList.remove("closed");
  const ch = $("chev-" + id); if (ch) ch.textContent = S.collapsed[id] ? "▸" : "▾";
  saveState();
}

let syncing = false;
/** Modifie un réglage. Toucher un réglage d'une section coupée la réactive. */
function setParam(k, v, fromSlider) {
  S.params[k] = v;
  syncControl(k, fromSlider);
  const tg = KEY_TOGGLE[k];
  if (tg && !S.params[tg] && k !== tg) { S.params[tg] = true; syncControl(tg); }
  updateDirty(); scheduleRender(); saveState();
}
function secOfToggle(tg) { return PR.SCHEMA.find(s => s.toggle === tg); }
function syncControl(k, skipSlider) {
  const v = S.params[k], p = PARAM_BY_KEY[k];
  syncing = true;
  try {
    if (p && p.type === "seg") {
      p.options.forEach(o => { const b = $("seg-" + k + "-" + o[1]); if (b) b.className = "segBtn" + (Number(v) === o[1] ? " on" : ""); });
    } else if (p) {
      const sl = $("sl-" + k); if (sl && !skipSlider) sl.value = v;
      const val = $("val-" + k); if (val && document.activeElement !== val) val.value = fmt(p, v);
      if (p.angle) PR.QUICK_ANGLES.forEach((a, i) => { const q = $("q-" + k + "-" + i); if (q) q.className = "qBtn" + (Number(v) === a ? " on" : ""); });
    }
    if (COLOR_FIELDS.indexOf(k) >= 0) {
      const ids = k === "core" ? ["core", "coreP"] : [k];
      ids.forEach(id => {
        const sw = $("sw-" + id); if (sw) sw.style.backgroundColor = v;
        const hx = $("hex-" + id); if (hx && document.activeElement !== hx) hx.value = String(v).toUpperCase();
      });
      if (/^gm|^core$/.test(k)) updateGradBar();
    }
    if (k === "colorMode") updateColorModeUI();
    if (TOGGLES.indexOf(k) >= 0) {
      const sec = secOfToggle(k);
      const t = sec && $("tg-" + sec.id); if (t) t.className = "tg" + (v ? " on" : "");
      const el = sec && $("sec-" + sec.id); if (el) { if (v) el.classList.remove("off"); else el.classList.add("off"); }
      renderChips();
    }
    if (k === "warpStyle") PR.WARP_STYLES.forEach(([s]) => { const b = $("ws-" + s); if (b) b.className = "stBtn" + (v === s ? " on" : ""); });
    if (k === "texInvert" || k === "bgTexInvert") { const c = $("ck-" + k); if (c) c.checked = !!v; }
    if (k === "tex") updateTexSelection("text");
    if (k === "bgTex") updateTexSelection("bg");
  } finally { syncing = false; }
}
const COLOR_FIELDS = ["core", "edge", "glowColor", "bg", "gmOuter", "gmMid", "gmInner"];
function updateGradBar() {
  const b = $("gradBar"); if (!b) return;
  const P = S.params;
  b.innerHTML = [P.gmOuter, P.gmMid, P.gmInner, P.core].map(c => `<div class="gbSeg" style="background-color:${c}"></div>`).join("");
}
function updateColorModeUI() {
  const m = S.params.colorMode == null ? (S.params.bichromie > 0 ? 1 : 0) : (S.params.colorMode | 0);
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? "block" : "none"; };
  show("gmBlock", m === 2); show("palBlock", m !== 2);
  const sp = $("swPlain"); if (sp) sp.style.display = m === 2 ? "none" : "flex";
  const eb = $("swb-edge"); if (eb) eb.style.display = m === 1 ? "flex" : "none";
  const se = $("btnSwapEdge"); if (se) se.style.display = m === 1 ? "block" : "none";
  ALL_PARAMS.forEach(p => {
    if (!p.show || !p.k) return;
    const ok = Object.keys(p.show).every(key => (S.params[key] == null ? 0 : Number(S.params[key])) === p.show[key]);
    const r = $("row-" + p.k); if (r) r.style.display = ok ? "block" : "none";
  });
  updateGradBar();
}
function syncAll() {
  Object.keys(PR.DEFAULTS).forEach(k => syncControl(k, false));
  const set = (id, v) => { const c = $(id); if (c) c.checked = !!v; };
  set("ck-hideText", S.ui.hideText); set("ck-replace", S.ui.replace); set("ck-closeAfter", S.ui.closeAfter);
  updateOutputUI(); renderTexturePicker("text"); renderTexturePicker("bg"); renderChips(); updateColorModeUI();
}
function templateValue(k) { const t = currentTpl(); return t ? t.params[k] : PR.DEFAULTS[k]; }

function wireParam(p) {
  if (!p.k) return;
  if (p.type === "seg") {
    p.options.forEach(o => { const b = $("seg-" + p.k + "-" + o[1]); if (b) b.addEventListener("click", () => setParam(p.k, o[1])); });
    return;
  }
  const sl = $("sl-" + p.k); if (!sl) return;
  const onSl = e => { if (syncing) return; const v = Number(e.target.value); if (!isNaN(v) && v !== S.params[p.k]) setParam(p.k, v, true); };
  sl.addEventListener("input", onSl);
  sl.addEventListener("change", onSl);
  const val = $("val-" + p.k);
  const commit = () => {
    let v = parseFloat(String(val.value).replace(",", "."));
    if (isNaN(v)) { val.value = fmt(p, S.params[p.k]); return; }
    v = Math.max(p.min, Math.min(p.max, v)); setParam(p.k, v); val.value = fmt(p, v);
  };
  val.addEventListener("change", commit);
  val.addEventListener("keydown", e => { if (e.key === "Enter") { commit(); val.blur(); } });
  $("lbl-" + p.k).addEventListener("dblclick", () => setParam(p.k, templateValue(p.k)));
  sl.addEventListener("dblclick", () => { setParam(p.k, PR.DEFAULTS[p.k]); status("« " + p.l + " » remis à sa valeur par défaut."); });
  if (p.angle) PR.QUICK_ANGLES.forEach((a, i) => $("q-" + p.k + "-" + i).addEventListener("click", () => setParam(p.k, a)));
}
function resetKeys(keys) {
  keys.forEach(k => { S.params[k] = templateValue(k); syncControl(k, false); });
  updateDirty(); scheduleRender(); saveState();
}
function sectionKeys(sec) {
  let keys = sec.params.filter(p => p.k).map(p => p.k);
  if (sec.id === "colors") keys = keys.concat(["core", "edge", "glowColor", "gmOuter", "gmMid", "gmInner"]);
  if (sec.id === "geom") keys = keys.concat(["warpStyle"]);
  if (sec.id === "texture") keys = Object.keys(PR.DEFAULTS).filter(k => /^tex/.test(k));
  if (sec.id === "bg") keys = Object.keys(PR.DEFAULTS).filter(k => /^bgTex/.test(k)).concat(["bg"]);
  if (sec.toggle) keys.push(sec.toggle);
  return keys;
}
function setToggle(tg, on) {
  S.params[tg] = on; syncControl(tg);
  updateDirty(); scheduleRender(); saveState();
  const sec = secOfToggle(tg);
  status((sec ? sec.title : tg) + (on ? " activé." : " désactivé."));
}
function wireColorField(k, label, domId) {
  const id = domId || k;
  $("sw-" + id).addEventListener("click", async () => { const c = await pickColor(S.params[k], label); if (c) setParam(k, c); });
  const hx = $("hex-" + id);
  const commit = () => {
    let v = String(hx.value).trim(); if (v[0] !== "#") v = "#" + v;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) { if (v.length === 4) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; setParam(k, v.toUpperCase()); }
    else hx.value = String(S.params[k]).toUpperCase();
  };
  hx.addEventListener("change", commit);
  hx.addEventListener("keydown", e => { if (e.key === "Enter") { commit(); hx.blur(); } });
}
function wireTexPicker(target) {
  const pre = target === "bg" ? "bgTex" : "tex";
  $("tp-" + target + "-import").addEventListener("click", () => importTextures(target));
  $("tp-" + target + "-random").addEventListener("click", () => {
    S.params[pre + "X"] = Math.round(Math.random() * 200 - 100); S.params[pre + "Y"] = Math.round(Math.random() * 200 - 100);
    syncControl(pre + "X"); syncControl(pre + "Y"); setParam(pre + "Amount", S.params[pre + "Amount"]);
  });
  $("tp-" + target + "-del").addEventListener("click", () => { const id = S.params[pre]; if (id) deleteUserTexture(id); });
  $("ck-" + pre + "Invert").addEventListener("change", e => { if (!syncing) setParam(pre + "Invert", !!e.target.checked); });
  PR.TEX_PARAMS[target].forEach(wireParam);
}
function wireSections() {
  PR.SCHEMA.forEach(sec => {
    $("head-" + sec.id).addEventListener("click", e => {
      const id = e.target && (e.target.id || (e.target.parentNode && e.target.parentNode.id));
      if (id === "reset-" + sec.id || id === "tg-" + sec.id) return;
      toggleSection(sec.id);
    });
    const rs = $("reset-" + sec.id);
    if (rs) rs.addEventListener("click", () => resetKeys(sectionKeys(sec)));
    const tg = $("tg-" + sec.id);
    if (tg) tg.addEventListener("click", () => setToggle(sec.toggle, !S.params[sec.toggle]));
    sec.params.forEach(wireParam);
  });

  // Couleurs
  PR.PALETTES.forEach((pal, i) => $("pal-" + i).addEventListener("click", () => {
    ["core", "edge", "glowColor", "bg"].forEach(k => { S.params[k] = pal[k]; syncControl(k); });
    if (!S.params.onColors) { S.params.onColors = true; syncControl("onColors"); }
    updateDirty(); scheduleRender(); saveState(); status("Jeu de couleurs « " + pal.name + " » appliqué (fond compris).");
  }));
  wireColorField("core", "Cœur"); wireColorField("edge", "Bords"); wireColorField("glowColor", "Glow"); wireColorField("bg", "Fond");
  wireColorField("gmOuter", "Extérieur du dégradé"); wireColorField("gmMid", "Bord du dégradé"); wireColorField("gmInner", "Intérieur du dégradé");
  wireColorField("core", "Texte / cœur", "coreP");
  PR.GRADIENTS.forEach((g, i) => $("grd-" + i).addEventListener("click", () => {
    ["gmOuter", "gmMid", "gmInner", "core"].forEach(k => { S.params[k] = g[k]; syncControl(k); });
    setParam("colorMode", 2); status("Dégradé « " + g.name + " » appliqué.");
  }));
  $("btnSwap").addEventListener("click", () => { const a = S.params.core; S.params.core = S.params.bg; S.params.bg = a; syncControl("core"); syncControl("bg"); setParam("onColors", true); });
  $("btnSwapEdge").addEventListener("click", () => { const a = S.params.core; S.params.core = S.params.edge; S.params.edge = a; syncControl("core"); syncControl("edge"); setParam("onColors", true); });

  // Perspective
  PR.WARP_STYLES.forEach(([k]) => $("ws-" + k).addEventListener("click", () => {
    if (k !== "none" && !S.params.warpBend) { S.params.warpBend = 40; syncControl("warpBend"); }
    setParam("warpStyle", k);
  }));
  $("btnGeomReset").addEventListener("click", () => {
    Object.assign(S.params, PR.NEUTRAL.onGeom);
    Object.keys(PR.NEUTRAL.onGeom).forEach(k => syncControl(k));
    updateDirty(); scheduleRender(); saveState();
  });

  // Textures
  wireTexPicker("text"); wireTexPicker("bg");

  // Sortie (fournie par l'hôte)
  if (HOST.wireOutput) HOST.wireOutput();
}

/* Sélecteurs de textures (texte et fond) */
function renderTexturePicker(target) {
  const grid = $("tp-" + target + "-grid"); if (!grid) return;
  const catKey = target;
  if (typeof S.ui.texCat !== "object" || !S.ui.texCat) S.ui.texCat = { text: "Tout", bg: "Tout" };
  const cats = ["Tout"]; allTextures().forEach(t => { if (cats.indexOf(t.cat) < 0) cats.push(t.cat); });
  if (cats.indexOf(S.ui.texCat[catKey]) < 0) S.ui.texCat[catKey] = "Tout";
  const cur = S.ui.texCat[catKey];
  $("tp-" + target + "-cats").innerHTML = cats.map((c, i) => `<div class="fBtn${c === cur ? " on" : ""}" id="tc-${target}-${i}">${esc(c)}</div>`).join("");
  cats.forEach((c, i) => $("tc-" + target + "-" + i).addEventListener("click", () => { S.ui.texCat[catKey] = c; renderTexturePicker(target); saveState(); }));
  const list = allTextures().filter(t => cur === "Tout" || t.cat === cur);
  grid.innerHTML = `<div class="texItem" id="ti-${target}-none"><div class="texNone">∅</div><div class="texName">Aucune</div></div>` +
    list.map(t => `<div class="texItem" id="ti-${target}-${t.id}"><img class="texImg" src="${t.user ? t.thumbData : t.thumb}" /><div class="texName">${esc(t.name)}</div></div>`).join("");
  const key = target === "bg" ? "bgTex" : "tex", ak = key + "Amount";
  $("ti-" + target + "-none").addEventListener("click", () => setParam(key, ""));
  list.forEach(t => $("ti-" + target + "-" + t.id).addEventListener("click", () => {
    if (!S.params[ak]) { S.params[ak] = 60; syncControl(ak); }
    setParam(key, t.id);
    getTexture(t.id).then(() => scheduleRender(true));
  }));
  updateTexSelection(target);
}
function updateTexSelection(target) {
  const key = target === "bg" ? "bgTex" : "tex";
  const cur = S.params[key];
  const grid = $("tp-" + target + "-grid"); if (!grid) return;
  const items = grid.querySelectorAll(".texItem");
  for (let i = 0; i < items.length; i++) items[i].classList.remove("on");
  const el = $(cur ? "ti-" + target + "-" + cur : "ti-" + target + "-none"); if (el) el.classList.add("on");
  const t = texById(cur);
  const info = $("tp-" + target + "-info");
  if (info) info.textContent = t ? `${t.name} · ${t.w}×${t.h} px · ${t.credit || ""}` : (target === "bg" ? "Fond uni, sans texture." : "Aucune texture sur le texte.");
  const del = $("tp-" + target + "-del"); if (del) del.style.display = t && t.user ? "block" : "none";
}

/* Résumé des effets actifs (sous l'aperçu) : clic = ouvrir la section */
function renderChips() {
  const box = $("fxChips"); if (!box) return;
  const on = PR.SCHEMA.filter(sec => sec.toggle && S.params[sec.toggle]);
  box.innerHTML = on.length ? on.map(sec => `<div class="chip" id="chip-${sec.id}">${esc(sec.title)}</div>`).join("") : `<div class="chipNone">Aucun effet actif</div>`;
  on.forEach(sec => $("chip-" + sec.id).addEventListener("click", () => openSection(sec.id)));
}
function openSection(id) {
  if (S.collapsed[id]) toggleSection(id);
  const el = $("sec-" + id), sc = $("scroll");
  if (el && sc) sc.scrollTop = Math.max(0, el.offsetTop - sc.offsetTop - 6);
}
function setAllCollapsed(mode) {
  ["templates"].concat(PR.SCHEMA.map(s => s.id)).forEach(id => {
    const sec = PR.SCHEMA.find(s => s.id === id);
    let want;
    if (mode === "all") want = true;
    else if (mode === "none") want = false;
    else want = id === "templates" ? true : !(sec && (sec.toggle ? S.params[sec.toggle] : false));
    if (!!S.collapsed[id] !== want) { if (id === "templates") $("head-templates").click(); else toggleSection(id); }
  });
}

function wireStatic() {
  $("head-templates").addEventListener("click", () => {
    S.collapsed.templates = !S.collapsed.templates;
    const el = $("sec-templates");
    if (S.collapsed.templates) el.classList.add("closed"); else el.classList.remove("closed");
    $("chev-templates").textContent = S.collapsed.templates ? "▸" : "▾"; saveState();
  });
  if (S.collapsed.templates) { $("sec-templates").classList.add("closed"); $("chev-templates").textContent = "▸"; }
  if ($("btnRefresh")) $("btnRefresh").addEventListener("click", () => HOST.refresh && HOST.refresh());
  $("btnZero").addEventListener("click", resetAll);
  ["auto", "checker", "dark", "light"].forEach(m => $("pvbg-" + m).addEventListener("click", () => { S.pvBg = m; updatePvBar(); scheduleRender(); saveState(); }));
  ["S", "M", "L", "XL"].forEach(m => $("pvs-" + m).addEventListener("click", () => { S.pvSize = m; applyPvSize(); scheduleRender(); saveState(); }));
  $("btnCompare").addEventListener("click", () => {
    S.compare = !S.compare;
    $("btnCompare").textContent = S.compare ? "Après" : "Avant";
    $("pvBadge").style.display = S.compare ? "block" : "none";
    scheduleRender();
  });
  $("btnSeed").addEventListener("click", () => setParam("seed", 1 + Math.floor(Math.random() * 9999)));
  $("tplSave").addEventListener("click", tplSave);
  $("tplNew").addEventListener("click", tplNew);
  $("tplDup").addEventListener("click", tplDup);
  $("tplDel").addEventListener("click", tplDel);
  $("tplRevert").addEventListener("click", tplRevert);
  $("tplImport").addEventListener("click", tplImport);
  $("tplExport").addEventListener("click", tplExport);
  $("tplRestore").addEventListener("click", tplRestore);
  $("tplName").addEventListener("keydown", e => { if (e.key === "Enter") tplSave(); });
  $("btnResetAll").addEventListener("click", () => { tplRevert(); status("Réglages remis aux valeurs du template."); });
  $("btnApply").addEventListener("click", () => HOST.apply && HOST.apply());
  $("fold-all").addEventListener("click", () => setAllCollapsed("all"));
  $("fold-none").addEventListener("click", () => setAllCollapsed("none"));
  $("fold-active").addEventListener("click", () => setAllCollapsed("active"));
  wirePreviewDrag();
}
function updatePvBar() {
  ["auto", "checker", "dark", "light"].forEach(m => { $("pvbg-" + m).className = "segBtn" + (S.pvBg === m ? " on" : ""); });
  ["S", "M", "L", "XL"].forEach(m => { $("pvs-" + m).className = "segBtn" + (S.pvSize === m ? " on" : ""); });
}


/* ---------- Lecture de la source pour l'aperçu ---------- */
function noSource(msg) { setSource(null); $("srcName").textContent = "Aucun calque"; $("pvEmptyMsg").textContent = msg; }


/* ======================================================================= */
/*  APERÇU                                                                  */
/* ======================================================================= */
function scaledMask(k) {
  const key = k.toFixed(4);
  let m = S.maskCache.get(key);
  if (!m) {
    const src = S.src, w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
    m = { a: k === 1 ? src.mask : E.resizeMask(src.mask, src.w, src.h, w, h), w, h };
    if (S.maskCache.size > 8) S.maskCache.clear();
    S.maskCache.set(key, m);
  }
  return m;
}
function scaledSample(src, k) {
  const key = "s" + k.toFixed(4);
  if (!src.cache) src.cache = new Map();
  let m = src.cache.get(key);
  if (!m) {
    const w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
    m = { a: k === 1 ? src.mask : E.resizeMask(src.mask, src.w, src.h, w, h), w, h };
    if (src.cache.size > 4) src.cache.clear();
    src.cache.set(key, m);
  }
  return m;
}
function renderAt(P, maxDim, cache, texText, srcOverride) {
  const src = srcOverride || S.src;
  const padU = E.computePad(P, { tw: src.w, th: src.h, unit: src.unit });
  const pad1 = padU * src.unit, cw1 = src.w + 2 * pad1, ch1 = src.h + 2 * pad1;
  let k = Math.min(1, maxDim / Math.max(cw1, ch1));
  k = Math.max(0.02, Math.floor(k * 50) / 50);
  const m = srcOverride ? scaledSample(srcOverride, k) : scaledMask(k), unit = src.unit * k, pad = Math.ceil(padU * unit) + 2;
  const cv = E.makeCanvas(m.a, m.w, m.h, pad, unit);
  const pxScale = k * src.scale;
  const r = E.render(cv, P, { cache, pxScale, texText });
  return { img: r.img, meta: r.meta, w: cv.w, h: cv.h, pxScale, ax: cv.ox + cv.tw / 2, ay: cv.oy + cv.th / 2 };
}
/** « Avant » : le texte d'origine (couleur du calque), sans aucun effet, sur le même fond. */
function neutralParams() {
  const P = Object.assign({}, S.params, { onColors: false });
  Object.keys(PR.NEUTRAL).forEach(k => { P[k] = false; });
  return eff(P);
}

function drawHandles(rgb, w, h, meta, sc) {
  const p = meta && meta.prog; if (!p || !p.active) return;
  const lw = Math.max(1, 1.2 / sc), dash = Math.max(3, 7 / sc), knob = Math.max(3, 6 / sc);
  const cols = { start: [255, 74, 28], end: [255, 255, 255] };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - p.cx, dy = y + 0.5 - p.cy;
    const fx = p.c * dx + p.s * dy, fy = -p.s * dx + p.c * dy;
    for (const [pos, col] of [[p.startPos, cols.start], [p.endPos, cols.end]]) {
      const d = Math.abs(fx - pos);
      const onKnob = Math.sqrt((fx - pos) * (fx - pos) + fy * fy) < knob;
      const onLine = d < lw && (Math.floor(Math.abs(fy) / dash) % 2 === 0);
      if (onKnob || onLine) { const j = (y * w + x) * 3; rgb[j] = col[0]; rgb[j + 1] = col[1]; rgb[j + 2] = col[2]; }
    }
  }
}
let renderTimer = null, hqTimer = null;
function scheduleRender(hqNow) {
  clearTimeout(hqTimer);
  const run = async hq => {
    if (S.busy) { S.pending = hq ? "hq" : (S.pending || "draft"); return; }
    S.busy = true;
    try { await renderPreview(hq); }
    catch (e) { console.log(e); status("Erreur d'aperçu : " + (e && e.message || e), "err"); }
    finally {
      S.busy = false;
      if (S.pending) { const p = S.pending; S.pending = null; run(p === "hq"); }
    }
  };
  if (hqNow) { setTimeout(() => run(true), 0); return; }
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; run(false); }, 16);
  hqTimer = setTimeout(() => run(true), HQ_DELAY);
}

/* Poignées du flou progressif : glisser dans l'aperçu */

/* ==========================================================================
   ADAPTATIONS NAVIGATEUR (communes à la page web et au complément PowerPoint)
   ========================================================================== */
const TEX_CACHE_MAX = 3;
const TEXT_PREVIEW_MAX = 1600;       // taille max du masque de texte pour l'aperçu
const EXPORT_MAX_PIXELS = 40e6;

/* ---------- Section « Sortie » fournie par l'hôte ---------- */
(function () {
  const out = PR.SCHEMA.find(x => x.id === "output");
  if (out) { out.title = HOST.outputTitle || "Export"; out.sub = HOST.outputSub || "image · réglages"; }
})();
function outputHTML() { return (HOST.outputHTML ? HOST.outputHTML() : "") + `<div class="grp">Journal</div><div class="opLog" id="opLog"><div class="logLine">Aucune opération pour l'instant.</div></div>`; }
function updateOutputUI() { if (HOST.updateOutputUI) HOST.updateOutputUI(); updateApplyLabel(); }

/* ---------- Petit stockage clé/valeur (IndexedDB, repli localStorage) ---------- */
const KV = (() => {
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      let r; try { r = indexedDB.open("inklab", 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function get(k) {
    try {
      const d = await open();
      return await new Promise((res, rej) => { const t = d.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
    } catch (e) { try { const v = localStorage.getItem("inklab.kv." + k); return v == null ? undefined : JSON.parse(v); } catch (e2) { return undefined; } }
  }
  async function set(k, v) {
    try {
      const d = await open();
      await new Promise((res, rej) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch (e) { try { if (!(v instanceof Blob)) localStorage.setItem("inklab.kv." + k, JSON.stringify(v)); } catch (e2) { /* plein */ } }
  }
  async function del(k) {
    try { const d = await open(); await new Promise(res => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = res; t.onerror = res; }); }
    catch (e) { try { localStorage.removeItem("inklab.kv." + k); } catch (e2) { /* ignore */ } }
  }
  return { get, set, del };
})();

function rgbToHex(r, g, b) { const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); return ("#" + h(r) + h(g) + h(b)).toUpperCase(); }
function maskIsEmpty(m) { for (let i = 0; i < m.length; i += 7) if (m[i] > 0.02) return false; return true; }
function labelFor() { const t = currentTpl(); return t ? t.name + (isDirty() ? "*" : "") : "perso"; }
function setBanner(kind, html, buttons) {
  const b = $("ctxBanner"); if (!b) return;
  if (!kind) { b.className = ""; return; }
  b.className = "on" + (kind === "edit" ? " edit" : "");
  $("bnTxt").innerHTML = html;
  $("bnBtns").innerHTML = (buttons || []).map((x, i) => `<div class="btn mini ${x.cls || ""}" id="bn-${i}">${x.label}</div>`).join("");
  (buttons || []).forEach((x, i) => $("bn-" + i).addEventListener("click", x.fn));
}
function updateApplyLabel() { const b = $("btnApply"); if (b && HOST.applyLabel) b.textContent = HOST.applyLabel(); }

/* ---------- Sélecteur de couleur natif ---------- */
let colorInput = null;
function pickColor(hex) {
  return new Promise(resolve => {
    if (!colorInput) { colorInput = document.createElement("input"); colorInput.type = "color"; colorInput.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0"; document.body.appendChild(colorInput); }
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    colorInput.value = String(hex || "#ffffff").slice(0, 7).toLowerCase();
    colorInput.oninput = () => finish(colorInput.value.toUpperCase());
    colorInput.onchange = () => finish(colorInput.value.toUpperCase());
    try { colorInput.click(); } catch (e) { finish(null); }
  });
}

/* ---------- État persistant (réglages, préférences, texte) ---------- */
function saveState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => LS.set("state3", {
    params: S.params, currentId: S.currentId, pvBg: S.pvBg, pvSize: S.pvSize, collapsed: S.collapsed, ui: S.ui, filter: S.filter, text: S.text
  }), 300);
}

/* ---------- Templates : stockage local + espace privé (si l'hôte en offre un) ---------- */
let cloudTimer = null;
async function loadTemplates() {
  let arr = await KV.get("templates");
  if (Array.isArray(arr) && arr.length) S.templates = arr.map(normalizeTpl);
  if (!S.templates.length) S.templates = PR.BUILTIN.map(t => normalizeTpl(clone(t)));
  // templates d'origine ajoutés dans une nouvelle version (ceux que tu as supprimés ne reviennent pas)
  const known = (await KV.get("knownBuiltins")) || S.templates.filter(t => t.builtin).map(t => t.id);
  PR.BUILTIN.forEach(b => { if (known.indexOf(b.id) < 0 && !S.templates.some(t => t.id === b.id)) S.templates.push(normalizeTpl(clone(b))); });
  await KV.set("knownBuiltins", PR.BUILTIN.map(b => b.id));
}
async function saveTemplates() {
  await KV.set("templates", clone(S.templates));
  if (HOST.cloudSave) { clearTimeout(cloudTimer); cloudTimer = setTimeout(() => HOST.cloudSave(clone(S.templates)).catch(() => { /* hors ligne */ }), 800); }
}
/** Appelé par l'hôte quand ses templates en ligne arrivent (après le premier affichage). */
function mergeCloudTemplates(arr) {
  if (!Array.isArray(arr) || !arr.length) { saveTemplates(); return; }
  const local = JSON.stringify(S.templates), cloud = JSON.stringify(arr.map(normalizeTpl));
  if (local === cloud) return;
  S.templates = arr.map(normalizeTpl);
  KV.set("templates", clone(S.templates));
  if (!currentTpl()) S.currentId = null;
  renderFilter(); renderTemplateGrid(); updateDirty();
  logOp("Templates synchronisés depuis ton espace");
}
async function loadThumbStore() { S.thumbStore = (await KV.get("thumbs")) || {}; }
async function saveThumbStore() {
  const keep = {}; S.templates.forEach(t => { const k = thumbKey(t); if (S.thumbStore[k]) keep[k] = S.thumbStore[k]; });
  S.thumbStore = keep; await KV.set("thumbs", keep);
}

/* ---------- Images : décodage natif du navigateur ---------- */
async function blobToImage(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch (e) {
    bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("image illisible")); im.src = URL.createObjectURL(blob); });
  }
  const w = bmp.width, h = bmp.height;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const data = x.getImageData(0, 0, w, h).data;
  if (bmp.close) bmp.close();
  return { width: w, height: h, data, channels: 4 };
}
async function fetchBlob(url) { const r = await fetch(url); if (!r.ok) throw new Error("fichier introuvable : " + url); return r.blob(); }

async function loadSample() {
  try {
    const img = await blobToImage(await fetchBlob("assets/lorem.png"));
    const n = img.width * img.height, mask = new Float32Array(n);
    for (let i = 0; i < n; i++) mask[i] = img.data[i * 4] / 255;
    S.sample = { mask, w: img.width, h: img.height, unit: img.height / 2, scale: 1, key: "lorem" };
  } catch (e) { S.sample = null; console.log("lorem", e); }
}

/* ---------- Textures ---------- */
async function loadTextureLibrary() {
  try { const r = await fetch("textures/library.json"); S.texLib = await r.json(); }
  catch (e) { S.texLib = []; status("Bibliothèque de textures introuvable.", "err"); }
  S.userTex = (await KV.get("userTex")) || [];
}
async function saveUserTex() { await KV.set("userTex", S.userTex); }
async function getTexture(id, quiet) {
  if (!id) return null;
  if (S.texCache.has(id)) return S.texCache.get(id);
  if (S.texLoading.has(id)) return S.texLoading.get(id);
  const t = texById(id); if (!t) return null;
  const p = (async () => {
    if (!quiet && !S.applying) status("Chargement de la texture « " + t.name + " »…", "busy");
    const blob = t.user ? await KV.get("tex:" + t.id) : await fetchBlob(t.file);
    if (!blob) throw new Error("fichier de texture absent");
    const img = await blobToImage(blob);
    const tex = E.prepareTexture(img, !!t.gray);
    if (S.texCache.size >= TEX_CACHE_MAX) { const k = S.texCache.keys().next().value; S.texCache.delete(k); }
    S.texCache.set(id, tex); S.texLoading.delete(id);
    if (!quiet && !S.applying) status("Texture « " + t.name + " » prête (" + img.width + "×" + img.height + ").", "ok");
    return tex;
  })().catch(e => { S.texLoading.delete(id); status("Texture illisible : " + e.message, "err"); return null; });
  S.texLoading.set(id, p);
  return p;
}
function pickFiles(accept, multiple) {
  return new Promise(resolve => {
    const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = !!multiple;
    i.style.cssText = "position:fixed;left:-100px;top:0;opacity:0";
    i.onchange = () => { resolve(Array.from(i.files || [])); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}
async function importTextures(target) {
  const files = await pickFiles("image/jpeg,image/png,image/webp", true);
  if (!files.length) return;
  let n = 0;
  for (const f of files) {
    try {
      status("Import de « " + f.name + " »…", "busy");
      const img = await blobToImage(f);
      const id = "user-" + uid();
      await KV.set("tex:" + id, f);
      const tw = 150, th = 100, rgb = new Uint8Array(tw * th * 3);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const sx = Math.floor(x * img.width / tw), sy = Math.floor(y * img.height / th), j = (sy * img.width + sx) * 4, k = (y * tw + x) * 3;
        rgb[k] = img.data[j]; rgb[k + 1] = img.data[j + 1]; rgb[k + 2] = img.data[j + 2];
      }
      S.userTex.push({ id, name: f.name.replace(/\.[^.]+$/, ""), cat: "Mes textures", user: true,
        thumbData: rgbToCanvas(rgb, tw, th).toDataURL("image/jpeg", 0.85), w: img.width, h: img.height, gray: false, credit: "Importée" });
      n++;
    } catch (e) { status("« " + f.name + " » illisible : " + e.message, "err"); }
  }
  await saveUserTex();
  if (typeof S.ui.texCat !== "object" || !S.ui.texCat) S.ui.texCat = { text: "Tout", bg: "Tout" };
  S.ui.texCat[target || "text"] = "Mes textures"; renderTexturePicker("text"); renderTexturePicker("bg");
  if (n) status(n + " texture(s) importée(s).", "ok");
}
async function deleteUserTexture(id) {
  const t = S.userTex.find(x => x.id === id); if (!t) return;
  await KV.del("tex:" + id);
  S.userTex = S.userTex.filter(x => x.id !== id); S.texCache.delete(id);
  await saveUserTex();
  ["tex", "bgTex"].forEach(k => { if (S.params[k] === id) S.params[k] = ""; });
  renderTexturePicker("text"); renderTexturePicker("bg"); scheduleRender();
  status("Texture « " + t.name + " » supprimée.", "ok");
}

/* ---------- Import / export de templates ---------- */
async function tplExport() {
  const json = JSON.stringify({ format: "inklab-templates", version: 2, templates: S.templates }, null, 2);
  if (HOST.saveFile) await HOST.saveFile("inklab-templates.json", json);
}
async function tplImport() {
  const files = await pickFiles(".json,application/json", false); if (!files.length) return;
  try {
    const data = JSON.parse(await files[0].text());
    const arr = Array.isArray(data) ? data : (data.templates || (data.params ? [data] : []));
    if (!arr.length) throw new Error("aucun template dans ce fichier");
    arr.forEach(t => { const nt = normalizeTpl(t); nt.id = uid(); nt.builtin = false; nt.name = uniqueName(nt.name); S.templates.push(nt); });
    await saveTemplates(); renderFilter(); renderTemplateGrid();
    status(arr.length + " template(s) importé(s).", "ok");
  } catch (e) { status("Import impossible : " + e.message, "err"); }
}

/* ======================================================================= */
/*  TEXTE : polices et construction du masque                               */
/* ======================================================================= */
/* Catalogue complet Google Fonts (gfonts.js) : [famille, catégorie, graisses/100, italique] */
const GF = new Map((window.GF_FONTS || []).map(([f, c, w, i]) => [f, { family: f, cat: c, weights: w.split(".").map(x => Number(x) * 100), italic: !!i }]));
const GF_CATS = [["", "Toutes"], ["S", "Sans serif"], ["R", "Serif"], ["D", "Display"], ["H", "Manuscrites"], ["M", "Mono"]];
const GF_CAT_NAME = { S: "Sans serif", R: "Serif", D: "Display", H: "Manuscrite", M: "Mono", A: "Adobe Fonts" };
const CURATED = ["Anton", "Archivo Black", "Inter", "Archivo", "Bebas Neue", "Oswald", "Barlow Condensed", "Big Shoulders Display", "Unbounded",
  "Syne", "Bricolage Grotesque", "Space Grotesk", "Dela Gothic One", "Rubik Mono One", "Bowlby One", "Six Caps", "DM Serif Display", "Playfair Display", "Instrument Serif"].filter(f => GF.has(f));
const gfParam = f => encodeURIComponent(f).replace(/%20/g, "+");
const gfLoaded = new Map(), gfPreviewed = new Set();
function addCss(href) {
  return new Promise(res => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
    l.onload = () => res(true); l.onerror = () => res(false);
    document.head.appendChild(l);
    setTimeout(() => res(false), 8000);
  });
}
/** Charge toutes les graisses (et l'italique) d'une Google Font. */
function loadGoogleFont(family) {
  const g = GF.get(family); if (!g) return Promise.resolve(false);
  if (gfLoaded.has(family)) return gfLoaded.get(family);
  const combos = [];
  [0].concat(g.italic ? [1] : []).forEach(i => g.weights.forEach(w => combos.push(i + "," + w)));
  const spec = g.weights.length === 1 && g.weights[0] === 400 && !g.italic ? "" : ":ital,wght@" + combos.join(";");
  const p = addCss("https://fonts.googleapis.com/css2?family=" + gfParam(family) + spec + "&display=swap");
  gfLoaded.set(family, p);
  return p;
}
/* ---------- Adobe Fonts : projet web (identifiant public du kit) ---------- */
const ADOBE = new Map();           // famille -> { weights, italic }
let adobeKit = "";
async function loadAdobeKit(id, quiet) {
  id = String(id || "").trim().replace(/^.*typekit\.net\//, "").replace(/\.css.*$/, "").replace(/[^a-z0-9]/gi, "");
  if (!HOST.adobe || !id) return false;
  const before = new Set([...document.fonts].map(f => f.family + "|" + f.weight + "|" + f.style));
  const ok = await addCss("https://use.typekit.net/" + id + ".css");
  if (!ok) { if (!quiet) status("Projet Adobe Fonts « " + id + " » introuvable.", "err"); return false; }
  ADOBE.clear();
  [...document.fonts].forEach(f => {
    if (before.has(f.family + "|" + f.weight + "|" + f.style)) return;
    const fam = f.family.replace(/^["']|["']$/g, "");
    if (GF.has(fam)) return;
    const e = ADOBE.get(fam) || { weights: new Set(), italic: false };
    String(f.weight).split(" ").forEach(w => { const n = parseInt(w, 10); if (n) e.weights.add(n); });
    if (/italic|oblique/.test(f.style)) e.italic = true;
    ADOBE.set(fam, e);
  });
  adobeKit = id; S.ui.adobeKit = id; saveState();
  if (!quiet) status(ADOBE.size ? ADOBE.size + " police(s) Adobe Fonts chargée(s)." : "Projet chargé, mais aucune police trouvée dedans.", ADOBE.size ? "ok" : "err");
  logOp("Adobe Fonts : projet " + id + " · " + ADOBE.size + " famille(s)");
  return true;
}
/** Aperçus de la liste : une seule graisse par famille, par lots, seulement les lignes visibles. */
let pvQueue = [], pvTimer = null;
function previewFonts(fams) {
  fams.forEach(f => { if (!gfPreviewed.has(f) && !gfLoaded.has(f) && GF.has(f)) { gfPreviewed.add(f); pvQueue.push(f); } });
  clearTimeout(pvTimer);
  pvTimer = setTimeout(() => {
    while (pvQueue.length) {
      const batch = pvQueue.splice(0, 24);
      addCss("https://fonts.googleapis.com/css2?" + batch.map(f => {
        const ws = GF.get(f).weights, w = ws.indexOf(400) >= 0 ? 400 : ws[0];
        return "family=" + gfParam(f) + ":wght@" + w;
      }).join("&") + "&display=swap");
    }
  }, 60);
}
const TEXT_DEFAULTS = { text: "LOREM\nIPSUM", family: "Archivo Black", weight: 400, italic: false, size: 240, lineHeight: 92, tracking: 0, align: "center", upper: false, color: "#FFFFFF" };
S.text = Object.assign({}, TEXT_DEFAULTS);
S.fonts = [];          // polices importées { name, blob }

function fontString(T, px) { return `${T.italic ? "italic " : ""}${T.weight || 400} ${px}px "${T.family}", "Helvetica Neue", Arial, sans-serif`; }
function textLines(T) { let t = String(T.text || "").replace(/\r\n?/g, "\n"); if (T.upper) t = t.toUpperCase(); const l = t.split("\n"); while (l.length > 1 && !l[l.length - 1].trim()) l.pop(); return l.length ? l : [""]; }
async function ensureFont(T, px) {
  if (GF.has(T.family)) await loadGoogleFont(T.family);
  try { await document.fonts.load(fontString(T, px), textLines(T).join(" ") || "A"); } catch (e) { /* police système ou absente */ }
}
/** Police réellement disponible ? (compare avec deux polices de repli) */
function fontAvailable(family) {
  try {
    const c = document.createElement("canvas").getContext("2d"), s = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789";
    const m = f => { c.font = `72px ${f}`; return c.measureText(s).width; };
    const a = m("monospace"), b = m("serif");
    return m(`"${family}", monospace`) !== a || m(`"${family}", serif`) !== b;
  } catch (e) { return true; }
}
/** Dessine le texte et renvoie son masque recadré : { mask, w, h, lines, color } */
async function buildTextMask(T, px) {
  const lines = textLines(T);
  await ensureFont(T, px);
  const c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
  const font = fontString(T, px), track = (T.tracking || 0) / 1000 * px;
  x.font = font;
  try { x.letterSpacing = track + "px"; } catch (e) { /* non pris en charge */ }
  const widths = lines.map(l => x.measureText(l || " ").width);
  const m = x.measureText(lines.join("") || "Hg");
  const asc = Math.max(m.actualBoundingBoxAscent || px * 0.8, px * 0.2), desc = Math.max(m.actualBoundingBoxDescent || px * 0.2, 0);
  const lead = px * (T.lineHeight || 100) / 100;
  const margin = Math.ceil(px * 0.3) + Math.abs(track) * 2;
  const W = Math.ceil(Math.max(...widths) + margin * 2), H = Math.ceil(asc + desc + lead * (lines.length - 1) + margin * 2);
  if (W * H > 120e6) throw new Error("texte trop grand pour être rendu à cette taille");
  c.width = W; c.height = H;
  x.font = font; try { x.letterSpacing = track + "px"; } catch (e) { /* ignore */ }
  x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
  const maxW = Math.max(...widths);
  lines.forEach((l, i) => {
    let ox = margin;
    if (T.align === "center") ox = margin + (maxW - widths[i]) / 2;
    else if (T.align === "right") ox = margin + maxW - widths[i];
    x.fillText(l, ox, margin + asc + i * lead);
  });
  const d = x.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { if (d[(y * W + xx) * 4 + 3] > 8) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return { mask: new Float32Array(1), w: 1, h: 1, lines: lines.length, empty: true };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) mask[y * w + xx] = d[((y + y0) * W + xx + x0) * 4 + 3] / 255;
  return { mask, w, h, lines: lines.length, color: (T.color || "#FFFFFF").toUpperCase() };
}

/** Recalcule la source de l'aperçu à partir du texte. */
let srcJob = 0;
async function rebuildSource() {
  const job = ++srcJob;
  const T = S.text;
  if (!String(T.text || "").trim()) { noSource(HOST.emptyMessage ? HOST.emptyMessage() : "Tape un texte pour commencer."); return; }
  try {
    // taille de rendu bornée pour l'aperçu
    let px = T.size;
    const probe = await buildTextMask(T, Math.min(px, 200));
    // le texte est vectoriel : on le dessine directement à la résolution de l'aperçu (net à toutes les tailles)
    const k = probe.w > 1 ? Math.min(6, TEXT_PREVIEW_MAX / (Math.max(probe.w, probe.h) * px / Math.min(px, 200))) : 1;
    const m = await buildTextMask(T, px * k);
    if (job !== srcJob) return;
    if (m.empty) { noSource("Ce texte ne contient aucun caractère visible."); return; }
    setSource({ layerName: (T.text || "").replace(/\s+/g, " ").slice(0, 40), isText: true, lines: m.lines, mask: m.mask, w: m.w, h: m.h,
      scale: k, unit: m.h / m.lines, color: m.color, key: "txt:" + Date.now() });
    const warn = $("fontWarn");
    if (warn) warn.style.display = fontAvailable(T.family) ? "none" : "block";
    scheduleRender(true);
  } catch (e) { noSource("Rendu du texte impossible : " + (e.message || e)); }
}
let srcTimer = null;
function scheduleSource() { clearTimeout(srcTimer); srcTimer = setTimeout(rebuildSource, 120); }

/* ---------- Section « Texte » ---------- */
function textSectionHTML() {
  return `<div class="sec" id="sec-text">
    <div class="secHead" id="head-text"><span class="chev" id="chev-text">▾</span><span class="secNum">01</span>
      <span class="secTitle">TEXTE</span><span class="secSub">${HOST.textSub || "contenu · police · taille"}</span></div>
    <div class="secBody">
      <textarea id="tx-text" class="txt area" rows="3" spellcheck="false"></textarea>
      <div class="row"><div class="rowTop"><span class="lbl">Police</span></div>
        <div class="fontBtn" id="tx-font" tabindex="0" role="button" aria-haspopup="listbox"><span id="tx-fontName"></span><span id="tx-fontCat"></span><span class="fontChev">⌄</span></div>
        <div class="hint" id="fontWarn" style="display:none">Police introuvable sur cet ordinateur : une police de remplacement est utilisée. Importe le fichier de la police ci-dessous.</div>
      </div>
      <div class="twoCol">
        <div class="row"><div class="rowTop"><span class="lbl">Graisse</span></div><select id="tx-weight" class="sel"></select></div>
        <div class="row"><div class="rowTop"><span class="lbl">Style</span></div>
          <div class="seg"><div class="segBtn" id="tx-it-0">Droit</div><div class="segBtn" id="tx-it-1">Italique</div></div></div>
      </div>
      <div class="row"><div class="rowTop"><span class="lbl">Alignement</span></div>
        <div class="seg"><div class="segBtn" id="tx-al-left">Gauche</div><div class="segBtn" id="tx-al-center">Centre</div><div class="segBtn" id="tx-al-right">Droite</div></div></div>
      ${HOST.hideSize ? "" : `<div class="row"><div class="rowTop"><span class="lbl">Taille du texte (px, export 1×)</span><input class="val" id="txv-size" type="text" /></div>
        <input type="range" class="rng" id="tx-size" min="60" max="800" step="10" /></div>`}
      <div class="row"><div class="rowTop"><span class="lbl">Interligne</span><input class="val" id="txv-lineHeight" type="text" /></div>
        <input type="range" class="rng" id="tx-lineHeight" min="60" max="160" step="1" /></div>
      <div class="row"><div class="rowTop"><span class="lbl">Approche</span><input class="val" id="txv-tracking" type="text" /></div>
        <input type="range" class="rng" id="tx-tracking" min="-150" max="400" step="5" /></div>
      <div class="ckRow"><label class="ck"><input type="checkbox" id="tx-upper" /> Tout en majuscules</label></div>
      <div class="sw solo"><div class="swColor" id="sw-txcolor" title="Couleur d'origine (utilisée quand « Couleurs » est coupé)"></div>
        <div class="swMeta"><div class="swLbl">Couleur d'origine du texte</div><input class="hex" id="hex-txcolor" type="text" /></div></div>
      <div class="btnRow"><div class="btn mini" id="tx-import">+ Importer une police (.ttf, .otf, .woff2)…</div></div>
    </div></div>`;
}
function syncTextUI() {
  const T = S.text;
  const ta = $("tx-text"); if (!ta) return;
  if (document.activeElement !== ta) ta.value = T.text;
  const gf = GF.get(T.family) || (ADOBE.has(T.family) ? { cat: "A", weights: ([...ADOBE.get(T.family).weights].sort((a, b) => a - b).length ? [...ADOBE.get(T.family).weights].sort((a, b) => a - b) : [400]), italic: ADOBE.get(T.family).italic } : null);
  const fn = $("tx-fontName"); fn.textContent = T.family; fn.style.fontFamily = `"${T.family}", system-ui, sans-serif`;
  $("tx-fontCat").textContent = gf ? GF_CAT_NAME[gf.cat] : (S.fonts.some(f => f.name === T.family) ? "Importée" : (HOST.extraFont && HOST.extraFont() === T.family ? "Document" : "Installée"));
  if (GF.has(T.family)) loadGoogleFont(T.family);
  const ws = gf ? gf.weights : [100, 200, 300, 400, 500, 600, 700, 800, 900];
  if (gf && !gf.italic && T.italic) T.italic = false;
  const itb = $("tx-it-1"); if (itb) itb.classList.toggle("disabled", !!gf && !gf.italic);
  if (ws.indexOf(Number(T.weight)) < 0) T.weight = ws.indexOf(700) >= 0 && Number(T.weight) >= 700 ? 700 : ws[ws.length - 1 >= 0 ? Math.min(ws.length - 1, ws.indexOf(400) >= 0 ? ws.indexOf(400) : 0) : 0];
  const names = { 100: "Thin", 200: "Extralight", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extrabold", 900: "Black" };
  $("tx-weight").innerHTML = ws.map(w => `<option value="${w}">${names[w] || w}</option>`).join(""); $("tx-weight").value = String(T.weight);
  ["0", "1"].forEach(v => { $("tx-it-" + v).className = "segBtn" + ((T.italic ? "1" : "0") === v ? " on" : ""); });
  ["left", "center", "right"].forEach(a => { $("tx-al-" + a).className = "segBtn" + (T.align === a ? " on" : ""); });
  [["size", "px"], ["lineHeight", "%"], ["tracking", ""]].forEach(([k, u]) => {
    const r = $("tx-" + k), v = $("txv-" + k); if (!r) return;
    r.value = T[k]; if (document.activeElement !== v) v.value = T[k] + u;
  });
  $("tx-upper").checked = !!T.upper;
  $("sw-txcolor").style.backgroundColor = T.color; if (document.activeElement !== $("hex-txcolor")) $("hex-txcolor").value = T.color;
}

/* ---------- Sélecteur de police (toutes les Google Fonts) ---------- */
const FontPicker = (() => {
  let pop = null, anchor = null, cat = "", q = "", rows = [], active = -1, io = null;
  function build() {
    pop = document.createElement("div"); pop.id = "fontPop"; pop.setAttribute("role", "listbox");
    pop.innerHTML = `<div class="fpTop"><input id="fp-q" class="txt" type="search" placeholder="Rechercher parmi ${GF.size} polices" autocomplete="off" spellcheck="false" />
        <div class="fpCats">${GF_CATS.map(([k, l]) => `<div class="fBtn" data-c="${k}">${l}</div>`).join("")}</div></div>
      <div class="fpList" id="fp-list"></div>
      ${HOST.adobe ? `<div class="fpFoot adobe"><input id="fp-adobe" class="txt" type="text" placeholder="Identifiant du projet Adobe Fonts (ex. abc1def)" /><div class="btn mini" id="fp-adobeGo">Charger</div></div>` : ""}
      <div class="fpFoot"><input id="fp-sys" class="txt" type="text" placeholder="Police installée sur l'ordinateur (nom exact)" /><div class="btn mini" id="fp-imp">Importer…</div></div>`;
    document.body.appendChild(pop);
    $("fp-q").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); render(); });
    pop.querySelectorAll(".fpCats .fBtn").forEach(b => b.addEventListener("click", () => { cat = b.dataset.c; render(); $("fp-q").focus(); }));
    $("fp-sys").addEventListener("keydown", e => { if (e.key === "Enter") { const v = e.target.value.trim(); if (v) { choose(v); } } });
    $("fp-imp").addEventListener("click", () => { close(); importFonts(); });
    if (HOST.adobe) {
      const go = async () => { const v = $("fp-adobe").value; if (await loadAdobeKit(v)) render(); };
      $("fp-adobeGo").addEventListener("click", go);
      $("fp-adobe").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    }
    $("fp-list").addEventListener("click", e => { const r = e.target.closest(".fpRow"); if (r) choose(r.dataset.f); });
    pop.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); close(); anchor && anchor.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter" && e.target.id === "fp-q" && rows[active]) { e.preventDefault(); choose(rows[active].dataset.f); }
    });
    document.addEventListener("pointerdown", e => { if (pop.classList.contains("open") && !pop.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); }, true);
    window.addEventListener("resize", () => { if (pop.classList.contains("open")) place(); });
    io = new IntersectionObserver(es => previewFonts(es.filter(x => x.isIntersecting).map(x => x.target.dataset.f)), { root: $("fp-list"), rootMargin: "120px 0px" });
  }
  function rowHTML(f, sub) {
    const g = GF.get(f);
    return `<div class="fpRow${f === S.text.family ? " on" : ""}" data-f="${esc(f)}" role="option"><span class="fpName" style="font-family:&quot;${esc(f)}&quot;, system-ui">${esc(f)}</span><span class="fpSub">${sub || (g ? GF_CAT_NAME[g.cat] : "")}</span></div>`;
  }
  function render() {
    pop.querySelectorAll(".fpCats .fBtn").forEach(b => b.classList.toggle("on", b.dataset.c === cat));
    const match = f => (!q || f.toLowerCase().includes(q));
    const fromCat = f => !cat || (GF.get(f) && GF.get(f).cat === cat);
    let html = "";
    const host = HOST.extraFont && HOST.extraFont();
    if (!cat && host && match(host)) html += `<div class="fpSec">Police du document</div>` + rowHTML(host, "Document");
    const mine = S.fonts.map(f => f.name).filter(f => !cat && match(f));
    if (mine.length) html += `<div class="fpSec">Mes polices</div>` + mine.map(f => rowHTML(f, "Importée")).join("");
    const ad = [...ADOBE.keys()].filter(f => !cat && match(f)).sort();
    if (ad.length) html += `<div class="fpSec">Adobe Fonts · ${ad.length}</div>` + ad.map(f => rowHTML(f, "Adobe")).join("");
    const cur = CURATED.filter(f => match(f) && fromCat(f));
    if (!q && cur.length) html += `<div class="fpSec">Sélection Ink Lab</div>` + cur.map(f => rowHTML(f)).join("");
    const all = [...GF.keys()].filter(f => match(f) && fromCat(f));
    html += `<div class="fpSec">Google Fonts · ${all.length}</div>` + (all.length ? all.map(f => rowHTML(f)).join("") : `<div class="fpEmpty">Aucune police ne correspond à « ${esc(q)} ».</div>`);
    const list = $("fp-list"); list.innerHTML = html; list.scrollTop = 0;
    rows = [...list.querySelectorAll(".fpRow")];
    io.disconnect(); rows.forEach(r => io.observe(r));
    active = rows.findIndex(r => r.dataset.f === S.text.family);
    if (active < 0 && q && rows.length) active = 0;
    mark(false);
  }
  function mark(scroll) {
    rows.forEach((r, i) => r.classList.toggle("act", i === active));
    if (scroll && rows[active]) rows[active].scrollIntoView({ block: "nearest" });
  }
  function move(d) { if (!rows.length) return; active = Math.max(0, Math.min(rows.length - 1, (active < 0 ? -1 : active) + d)); mark(true); }
  function place() {
    const r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(Math.max(r.width, 300), vw - 24);
    const left = Math.max(12, Math.min(r.left, vw - w - 12));
    const below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < 320 && above > below;
    const h = Math.min(520, Math.max(220, up ? above - 6 : below - 6));
    pop.style.width = w + "px"; pop.style.left = left + "px"; pop.style.height = h + "px";
    pop.style.top = (up ? r.top - 6 - h : r.bottom + 6) + "px";
    pop.style.transformOrigin = (r.left + r.width / 2 - left) + "px " + (up ? "100%" : "0");   // naît du bouton
  }
  function open(a) {
    if (!pop) build();
    if (HOST.adobe && $("fp-adobe")) $("fp-adobe").value = adobeKit;
    anchor = a; q = ""; $("fp-q").value = ""; $("fp-sys").value = GF.has(S.text.family) ? "" : S.text.family;
    render(); place();
    pop.classList.add("open"); anchor.classList.add("open");
    requestAnimationFrame(() => { $("fp-q").focus({ preventScroll: true }); if (rows[active]) rows[active].scrollIntoView({ block: "center" }); });
  }
  function close() { if (!pop) return; pop.classList.remove("open"); if (anchor) anchor.classList.remove("open"); }
  function toggle(a) { if (pop && pop.classList.contains("open")) close(); else open(a); }
  function choose(f) { close(); setText("family", f); if (anchor) anchor.focus({ preventScroll: true }); status("Police « " + f + " »."); }
  return { open, close, toggle };
})();
function setText(k, v) { S.text[k] = v; syncTextUI(); saveState(); scheduleSource(); if (HOST.onTextChange) HOST.onTextChange(); }
function wireTextSection() {
  $("head-text").addEventListener("click", () => {
    S.collapsed.text = !S.collapsed.text;
    $("sec-text").classList.toggle("closed", !!S.collapsed.text); $("chev-text").textContent = S.collapsed.text ? "▸" : "▾"; saveState();
  });
  if (S.collapsed.text) { $("sec-text").classList.add("closed"); $("chev-text").textContent = "▸"; }
  $("tx-text").addEventListener("input", e => setText("text", e.target.value));
  $("tx-font").addEventListener("click", () => FontPicker.toggle($("tx-font")));
  $("tx-font").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); FontPicker.open($("tx-font")); } });
  $("tx-weight").addEventListener("change", e => setText("weight", Number(e.target.value)));
  ["0", "1"].forEach(v => $("tx-it-" + v).addEventListener("click", () => { if (v === "1" && $("tx-it-1").classList.contains("disabled")) { status("Cette police n'existe pas en italique."); return; } setText("italic", v === "1"); }));
  ["left", "center", "right"].forEach(a => $("tx-al-" + a).addEventListener("click", () => setText("align", a)));
  [["size", 60, 4000], ["lineHeight", 40, 200], ["tracking", -300, 1000]].forEach(([k, mn, mx]) => {
    const r = $("tx-" + k), v = $("txv-" + k); if (!r) return;
    r.addEventListener("input", e => setText(k, Number(e.target.value)));
    r.addEventListener("dblclick", () => setText(k, TEXT_DEFAULTS[k]));
    v.addEventListener("change", () => { const n = parseFloat(String(v.value).replace(",", ".")); if (!isNaN(n)) setText(k, Math.max(mn, Math.min(mx, n))); else syncTextUI(); });
  });
  $("tx-upper").addEventListener("change", e => setText("upper", !!e.target.checked));
  $("sw-txcolor").addEventListener("click", async () => { const c = await pickColor(S.text.color); if (c) setText("color", c); });
  $("hex-txcolor").addEventListener("change", e => { let v = e.target.value.trim(); if (v[0] !== "#") v = "#" + v; if (/^#[0-9a-fA-F]{6}$/.test(v)) setText("color", v.toUpperCase()); else syncTextUI(); });
  $("tx-import").addEventListener("click", importFonts);
}
async function registerFont(name, blob) {
  const ff = new FontFace(name, await blob.arrayBuffer());
  await ff.load(); document.fonts.add(ff);
}
async function loadFonts() {
  S.fonts = (await KV.get("fonts")) || [];
  for (const f of S.fonts) { try { await registerFont(f.name, f.blob); } catch (e) { console.log("police", f.name, e); } }
}
async function importFonts() {
  const files = await pickFiles(".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2", true);
  let last = null;
  for (const f of files) {
    const name = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    try {
      await registerFont(name, f);
      S.fonts = S.fonts.filter(x => x.name !== name).concat([{ name, blob: f }]);
      last = name;
    } catch (e) { status("Police « " + f.name + " » illisible.", "err"); }
  }
  await KV.set("fonts", S.fonts);
  if (last) { setText("family", last); status("Police « " + last + " » importée.", "ok"); }
}

/* ======================================================================= */
/*  APERÇU (canvas) et RENDU COMPLET                                        */
/* ======================================================================= */
function applyPvSize() {
  const box = $("pvBox"); if (!box) return;
  if (!HOST.fillPreview) box.style.height = (PV_HEIGHTS[S.pvSize] || 240) + "px";
  updatePvBar();
}
async function renderPreview(hq) {
  if (!S.src) return;
  const t0 = Date.now();
  const P = S.compare ? neutralParams() : eff(S.params);
  const box = $("pvBox");
  const bw = Math.max(120, box.clientWidth || 320), bh = Math.max(80, box.clientHeight || 240);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const maxDim = hq ? Math.min(HQ_MAX * 1.25, Math.max(bw, bh) * dpr * 1.1) : Math.min(DRAFT_MAX, Math.max(bw, bh) * 0.9);
  const texText = S.compare ? null : (P.tex ? S.texCache.get(P.tex) || null : null);
  const texBg = P.addBg && P.bgTex ? S.texCache.get(P.bgTex) || null : null;
  if ((P.tex && !texText && !S.compare) || (P.addBg && P.bgTex && !texBg)) {
    Promise.all([getTexture(P.tex), P.addBg ? getTexture(P.bgTex) : null]).then(() => scheduleRender(true));
  }
  const r = renderAt(P, maxDim, S.cache, texText);
  let bg;
  if (S.pvBg === "checker" || (S.pvBg === "auto" && !P.addBg)) bg = { checker: true };
  else if (S.pvBg === "dark") bg = { color: [0.05, 0.05, 0.055] };
  else if (S.pvBg === "light") bg = { color: [0.95, 0.95, 0.94] };
  else bg = { rgb: E.renderBackground(r.w, r.h, P, { pxScale: r.pxScale, ax: r.ax, ay: r.ay, texBg }) };
  const rgb = E.toRGB8(r.img, r.w, r.h, bg);
  const sc = Math.min(bw / r.w, bh / r.h);
  if (!S.compare) drawHandles(rgb, r.w, r.h, r.meta, sc);
  const cv = $("pvImg");
  cv.width = r.w; cv.height = r.h;
  const x = cv.getContext("2d"), id = x.createImageData(r.w, r.h), d = id.data;
  for (let i = 0, j = 0; i < r.w * r.h; i++, j += 3) { d[i * 4] = rgb[j]; d[i * 4 + 1] = rgb[j + 1]; d[i * 4 + 2] = rgb[j + 2]; d[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  cv.style.width = Math.max(1, Math.round(r.w * sc)) + "px";
  cv.style.height = Math.max(1, Math.round(r.h * sc)) + "px";
  cv.style.display = "block";
  const c = bg.color || E.hexToRgb(P.bg);
  box.style.backgroundColor = bg.checker ? "#1d1d20" : "rgb(" + c.map(v => Math.round(v * 255)).join(",") + ")";
  S.lastPv = { w: r.w, h: r.h, sc, meta: r.meta };
  $("pvHint").style.display = r.meta && r.meta.prog && r.meta.prog.active && !S.compare ? "block" : "none";
  $("pvMs").textContent = (hq ? "HD · " : "") + r.w + "×" + r.h + " · " + (Date.now() - t0) + " ms";
}
function setSource(src) {
  S.src = src; S.cache.clear(); S.maskCache.clear();
  const dot = $("srcDot");
  if (src) {
    $("srcName").textContent = "T  " + (src.layerName || "Texte");
    if (dot) dot.className = "srcDot on";
    $("pvEmpty").style.display = "none";
  } else { $("pvImg").style.display = "none"; $("pvEmpty").style.display = "flex"; if (dot) dot.className = "srcDot"; $("pvHint").style.display = "none"; }
}

/**
 * Rendu complet du texte courant à l'échelle `mul` (1 = taille du texte en px).
 * Renvoie { canvas, w, h, scaled, center:{x,y} (centre du texte dans l'image) }.
 */
async function renderFull(mul, opts) {
  opts = opts || {};
  const Praw = S.params;
  const T = S.text;
  let px = T.size * mul;
  let m = await buildTextMask(T, px);
  if (m.empty) throw new Error("le texte est vide");
  const P = PR.effective(Praw, m.color);
  const unit = m.h / m.lines;
  const pad = Math.ceil(E.computePad(P, { tw: m.w, th: m.h, unit }) * unit) + 2;
  let cv = E.makeCanvas(m.mask, m.w, m.h, pad, unit);
  const fullW = cv.w, fullH = cv.h;
  const f = Math.min(1, Math.sqrt(EXPORT_MAX_PIXELS / (fullW * fullH)));
  if (f < 1) cv = E.scaleCanvas(cv, f);
  const texText = await getTexture(P.tex, true);
  let img = E.render(cv, P, { cache: null, pxScale: mul * f, texText }).img;
  if (f < 1) img = E.resizeRGBA(img, cv.w, cv.h, fullW, fullH);
  const w = fullW, h = fullH;
  const withBg = opts.background != null ? opts.background : P.addBg;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const x = out.getContext("2d"), id = x.createImageData(w, h), d = id.data;
  let bgrgb = null;
  if (withBg) {
    const texBg = P.bgTex ? await getTexture(P.bgTex, true) : null;
    bgrgb = E.renderBackground(w, h, P, { pxScale: mul, ax: pad + m.w / 2, ay: pad + m.h / 2, texBg });
  }
  for (let i = 0; i < w * h; i++) {
    const a = Math.min(1, Math.max(0, img.a[i])), j = i * 4;
    if (bgrgb) {
      d[j] = Math.round(Math.min(1, img.r[i] + bgrgb[i * 3] * (1 - a)) * 255);
      d[j + 1] = Math.round(Math.min(1, img.g[i] + bgrgb[i * 3 + 1] * (1 - a)) * 255);
      d[j + 2] = Math.round(Math.min(1, img.b[i] + bgrgb[i * 3 + 2] * (1 - a)) * 255);
      d[j + 3] = 255;
    } else if (a > 1e-4) {
      d[j] = Math.round(Math.min(1, img.r[i] / a) * 255); d[j + 1] = Math.round(Math.min(1, img.g[i] / a) * 255);
      d[j + 2] = Math.round(Math.min(1, img.b[i] / a) * 255); d[j + 3] = Math.round(a * 255);
    }
  }
  x.putImageData(id, 0, 0);
  return { canvas: out, w, h, scaled: f, center: { x: pad + m.w / 2, y: pad + m.h / 2 }, textW: m.w, textH: m.h };
}
function canvasToBlob(c, type, q) { return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("export impossible")), type || "image/png", q)); }


/* ---------- Repères du flou : glisser dans l'aperçu (suivi 1:1, bords élastiques) ---------- */
function pvToCanvas(e) {
  const img = $("pvImg"); const r = img.getBoundingClientRect();
  const lp = S.lastPv; if (!lp || !r.width) return null;
  return { x: (e.clientX - r.left) * lp.w / r.width, y: (e.clientY - r.top) * lp.h / r.height };
}
function rubberband(over, dim, c) { c = c || 0.55; return (over * dim * c) / (dim + c * Math.abs(over)); }
function wirePreviewDrag() {
  const box = $("pvBox");
  const LO = -60, HI = 160;
  let grab = 0, startX = 0, startY = 0, armed = false, pid = null;
  const along = (p, pt) => p.c * (pt.x - p.cx) + p.s * (pt.y - p.cy);
  const toPct = (p, fx) => (fx - p.lo) / Math.max(1, p.hi - p.lo) * 100;
  const down = e => {
    if (e.button > 0) return;
    const lp = S.lastPv; const p = lp && lp.meta && lp.meta.prog;
    if (!p || !p.active || S.compare) return;
    const pt = pvToCanvas(e); if (!pt) return;
    const fx = along(p, pt);
    S.drag = Math.abs(fx - p.startPos) <= Math.abs(fx - p.endPos) ? "progStart" : "progEnd";
    grab = fx - (S.drag === "progStart" ? p.startPos : p.endPos);   // garde l'écart avec le repère saisi
    startX = e.clientX; startY = e.clientY; armed = false; pid = e.pointerId;
    try { box.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    box.classList.add("drag");
    e.preventDefault();
  };
  const move = e => {
    if (!S.drag || (pid != null && e.pointerId !== pid)) return;
    if (!armed) { if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return; armed = true; }
    const p = S.lastPv.meta.prog, pt = pvToCanvas(e); if (!pt) return;
    let v = toPct(p, along(p, pt) - grab);
    // au-delà des limites : résistance progressive au lieu d'un arrêt sec
    if (v < LO) v = LO - rubberband(LO - v, 60);
    if (v > HI) v = HI + rubberband(v - HI, 60);
    v = Math.round(v);
    if (S.drag === "progStart") v = Math.min(v, S.params.progEnd - 1); else v = Math.max(v, S.params.progStart + 1);
    if (v !== S.params[S.drag]) setParam(S.drag, v);
  };
  const up = e => {
    if (!S.drag) return;
    try { box.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const k = S.drag; S.drag = null; pid = null; box.classList.remove("drag");
    const v = S.params[k];                       // revient en douceur dans la plage autorisée
    if (v < LO || v > HI) setParam(k, Math.max(LO, Math.min(HI, v)));
    scheduleRender(true);
  };
  box.addEventListener("dblclick", () => {
    const lp = S.lastPv; if (!lp || !lp.meta || !lp.meta.prog || !lp.meta.prog.active) return;
    S.params.progStart = PR.DEFAULTS.progStart; syncControl("progStart");
    setParam("progEnd", PR.DEFAULTS.progEnd); status("Repères du flou remis par défaut.");
  });
  box.style.touchAction = "none";
  box.addEventListener("pointerdown", down);
  box.addEventListener("pointermove", move);
  box.addEventListener("pointerup", up);
  box.addEventListener("pointercancel", up);
}

/* ======================================================================= */
/*  DÉMARRAGE                                                               */
/* ======================================================================= */
async function init() {
  const st = LS.get("state3", null);
  if (st) {
    S.ui = Object.assign(S.ui, st.ui || {}); S.collapsed = st.collapsed || {};
    S.pvBg = st.pvBg || "auto"; S.pvSize = st.pvSize || "M"; S.filter = st.filter || "Tous";
    if (st.text) S.text = Object.assign({}, TEXT_DEFAULTS, st.text);
  }
  await Promise.all([loadTemplates(), loadTextureLibrary(), loadSample(), loadThumbStore(), loadFonts()]);
  if (st && st.params && (st.currentId === null || S.templates.some(t => t.id === st.currentId))) {
    S.params = Object.assign({}, PR.DEFAULTS, st.params); S.currentId = st.currentId;
    if (st.params.onGeom === undefined) PR.autoToggles(S.params);
  } else {
    const first = S.templates.find(t => t.id === "builtin3-photocopie") || S.templates[0];
    S.currentId = first.id; S.params = Object.assign({}, PR.DEFAULTS, clone(first.params));
  }
  $("textSlot").innerHTML = textSectionHTML();
  buildSections(); wireStatic(); wireSections(); wireTextSection(); renderFilter(); renderTemplateGrid();
  window.__inkBuilt = true; if (window.InkLayout) window.InkLayout();
  // numérotation : Texte 01, Templates 02, puis les sections
  document.querySelectorAll("#scroll .secNum").forEach((el, i) => { el.textContent = String(i + 1).padStart(2, "0"); });
  const t = currentTpl(); $("tplName").value = t ? t.name : "";
  syncAll(); syncTextUI(); updateDirty(); applyPvSize();
  if (HOST.init) await HOST.init();
  if (HOST.adobe && (S.ui.adobeKit || HOST.defaultAdobeKit)) { await loadAdobeKit(S.ui.adobeKit || HOST.defaultAdobeKit, true); syncTextUI(); }
  updateApplyLabel();
  if (!S.src) await rebuildSource();
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => scheduleRender(true), 150); });
}
init().catch(e => { console.error(e); status("Erreur au démarrage : " + (e && e.message || e), "err"); });
