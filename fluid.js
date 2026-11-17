/* INK LAB — comportements « fluides » (chargé après app.js)
   - segments : curseur qui glisse d'une option à l'autre (ressort, interruptible)
   - sections : ouverture / fermeture animées depuis la hauteur affichée
   - curseurs : piste remplie jusqu'à la valeur */
(function () {
  const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Segments ---------- */
  function placeThumb(seg) {
    let th = seg.querySelector(":scope > .segThumb");
    if (!th) { th = document.createElement("div"); th.className = "segThumb"; seg.insertBefore(th, seg.firstChild); }
    const on = seg.querySelector(":scope > .segBtn.on");
    if (!on || !on.offsetWidth) { seg.classList.add("noThumb"); return; }
    seg.classList.remove("noThumb");
    th.style.width = on.offsetWidth + "px";
    th.style.transform = "translateX(" + on.offsetLeft + "px)";
    if (!seg.classList.contains("ready")) requestAnimationFrame(() => seg.classList.add("ready"));
  }
  let segQueue = new Set(), segRaf = 0;
  function queueSeg(seg) { if (!seg) return; segQueue.add(seg); if (!segRaf) segRaf = requestAnimationFrame(() => { segRaf = 0; segQueue.forEach(placeThumb); segQueue.clear(); }); }
  function allSegs() { document.querySelectorAll(".seg").forEach(queueSeg); }

  /* ---------- Sections ---------- */
  const anims = new WeakMap(), lastH = new WeakMap();
  const ro = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => {
    const b = e.borderBoxSize && e.borderBoxSize[0];
    lastH.set(e.target, b ? b.blockSize : e.target.getBoundingClientRect().height);
  })) : null;
  function watchBodies() { if (ro) document.querySelectorAll(".secBody").forEach(b => { if (!b.__ro) { b.__ro = 1; ro.observe(b); lastH.set(b, b.getBoundingClientRect().height); } }); }
  function animateSection(sec) {
    const body = sec.querySelector(":scope > .secBody"); if (!body || reduce()) return;
    const closing = sec.classList.contains("closed");
    // part de la dernière hauteur affichée (y compris en pleine animation) : pas de saut
    const from = lastH.has(body) ? lastH.get(body) : (closing ? body.scrollHeight : 0);
    const prev = anims.get(body); if (prev) prev.cancel();
    body.style.height = "";
    const to = closing ? 0 : body.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    body.classList.add("anim");
    const a = body.animate([{ height: from + "px" }, { height: to + "px" }], {
      duration: 460, easing: getComputedStyle(document.documentElement).getPropertyValue("--spring").trim() || "ease-out"
    });
    anims.set(body, a);
    const done = () => { if (anims.get(body) === a) { anims.delete(body); body.classList.remove("anim"); queueAllSegs(); } };
    a.onfinish = done; a.oncancel = done;
  }
  function queueAllSegs() { allSegs(); }

  /* ---------- Curseurs ---------- */
  function fill(r) {
    const mn = Number(r.min) || 0, mx = Number(r.max) || 100, v = Number(r.value);
    r.style.setProperty("--p", (Math.max(0, Math.min(1, (v - mn) / ((mx - mn) || 1))) * 100).toFixed(2) + "%");
  }
  function fillAll() { document.querySelectorAll("input.rng").forEach(fill); }
  document.addEventListener("input", e => { if (e.target && e.target.classList && e.target.classList.contains("rng")) fill(e.target); }, true);

  /* les valeurs posées par le code (templates, réinitialisation) mettent aussi la piste à jour */
  if (typeof window.syncControl === "function") {
    const orig = window.syncControl;
    window.syncControl = function (k, skip) { const r = orig.apply(this, arguments); const el = document.getElementById("sl-" + k); if (el) fill(el); return r; };
  }

  /* ---------- Observation ---------- */
  const mo = new MutationObserver(list => {
    let rescan = false;
    for (const m of list) {
      if (m.type === "attributes") {
        const t = m.target;
        if (t.classList.contains("segBtn")) queueSeg(t.parentNode);
        else if (t.classList.contains("sec") && (m.oldValue || "").includes("closed") !== t.classList.contains("closed")) animateSection(t);
      } else if (m.addedNodes.length) rescan = true;
    }
    if (rescan) { allSegs(); fillAll(); watchBodies(); }
  });
  function start() {
    mo.observe(document.getElementById("app") || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    allSegs(); fillAll(); watchBodies();
    window.addEventListener("resize", allSegs);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(allSegs);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  setTimeout(() => { allSegs(); fillAll(); }, 600);
})();
