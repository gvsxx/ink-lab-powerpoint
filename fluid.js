/* INK LAB — mise en page « app » : scène (aperçu + styles) et inspecteur à onglets.
   Réorganise les éléments construits par le panneau commun sans toucher à leur logique
   (tous les identifiants restent les mêmes). */
(function () {
  const TABS = [["text", "Texte"], ["fx", "Effets"], ["out", HOST.outputTitle || "Export"]];
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function build() {
    if (document.body.classList.contains("laid")) return;
    const pvWrap = $("pvWrap"), pvBox = $("pvBox"), scroll = $("scroll");
    const secTpl = $("sec-templates"), sections = $("sections");

    /* ---- Scène : capsule flottante sur l'aperçu ---- */
    const bar = pvWrap.querySelector(".pvBar");
    bar.classList.add("hud"); pvBox.appendChild(bar);
    if (document.body.classList.contains("ppt") || window.innerWidth <= 520) bar.querySelectorAll(".btn").forEach(b => { if (/Varier/.test(b.textContent)) { b.title = "Varier"; b.textContent = "⟳"; } });
    // statut : petit message flottant (HUD) en haut de la scène
    const st = $("status"); pvBox.appendChild(st);
    // status() réécrit className : l'affichage passe par data-show (non observé, donc pas de boucle)
    let tTimer = null;
    new MutationObserver(() => {
      if (!st.textContent.trim()) return;
      st.dataset.show = "1"; clearTimeout(tTimer);
      if (st.classList.contains("busy")) return;
      tTimer = setTimeout(() => { delete st.dataset.show; }, st.classList.contains("err") ? 6000 : 2600);
    }).observe(st, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    st.addEventListener("click", () => { delete st.dataset.show; });

    /* ---- Styles : bande horizontale sous l'aperçu ---- */
    const strip = el("div", "styles");
    const head = el("div", "stylesHead", `<span class="stylesTitle">Styles</span>`);
    head.appendChild($("tplFilter"));
    strip.appendChild(head);
    strip.appendChild($("tplGrid"));
    const chips = pvWrap.querySelector(".chipsRow");
    pvWrap.appendChild(strip);   // (déplacée dans le défilement pour le volet PowerPoint, plus bas)
    // flèches de défilement (pointeur précis) : défilement doux d'une page
    const grid = $("tplGrid");
    ["prev", "next"].forEach(d => {
      const b = el("div", "stripNav " + d, d === "prev" ? "‹" : "›");
      b.title = d === "prev" ? "Styles précédents" : "Styles suivants";
      b.addEventListener("click", () => grid.scrollBy({ left: (d === "prev" ? -1 : 1) * grid.clientWidth * 0.8, behavior: "smooth" }));
      strip.appendChild(b);
    });

    /* ---- Inspecteur à onglets ---- */
    const tabs = el("div", "tabs");
    const seg = el("div", "seg tabSeg", TABS.map(([k, l]) => `<div class="segBtn" id="tab-${k}" role="tab">${l}</div>`).join(""));
    tabs.appendChild(seg);
    scroll.insertBefore(tabs, scroll.firstChild);
    if (document.body.classList.contains("ppt")) { strip.classList.add("inScroll"); scroll.insertBefore(strip, tabs); }
    const pText = el("div", "panel"), pFx = el("div", "panel"), pOut = el("div", "panel");
    pText.id = "panel-text"; pFx.id = "panel-fx"; pOut.id = "panel-out";
    const endSpace = scroll.querySelector(".endSpace");
    [pText, pFx, pOut].forEach(p => scroll.insertBefore(p, endSpace));   // dans le document d'abord : les $() suivants les trouvent
    pText.appendChild($("textSlot"));

    // style courant : nom, enregistrer, nouveau…
    const cur = el("div", "sec curStyle"); pFx.appendChild(cur);
    cur.innerHTML = `<div class="secHead static"><span class="secTitle">Style actuel</span><span class="secSub" id="curSub"></span></div><div class="secBody"></div>`;
    const tplEdit = secTpl.querySelector(".tplEdit");
    cur.querySelector(".secBody").appendChild(tplEdit);
    const revert = $("btnResetAll"); revert.classList.add("mini"); revert.textContent = "↺ Revenir au style";
    // l'essentiel d'abord (nom + Enregistrer + Nouveau), le reste un niveau plus bas
    const rows = tplEdit.querySelectorAll(".btnRow");
    const top = tplEdit.querySelector(".rowTop"); if (top) top.hidden = true;
    const line = el("div", "nameLine"); tplEdit.insertBefore(line, $("tplName"));
    line.appendChild($("tplName")); line.appendChild($("tplSave"));
    $("tplName").placeholder = "Nom du style";
    $("tplSave").textContent = "Enregistrer";
    const main = rows[0], more = rows[1];
    const bNew = $("tplNew"), bDup = $("tplDup"), bDel = $("tplDel");
    main.innerHTML = ""; main.appendChild(bNew); main.appendChild(revert);
    const moreBtn = el("div", "btn mini ghost moreBtn", "Plus…"); moreBtn.tabIndex = 0; main.appendChild(moreBtn);
    [bDel, bDup].forEach(b => more.insertBefore(b, more.firstChild));
    more.classList.add("moreRow"); more.hidden = true;
    moreBtn.addEventListener("click", () => { more.hidden = !more.hidden; moreBtn.textContent = more.hidden ? "Plus…" : "Moins"; });
    if (chips) { chips.classList.add("inPanel"); pFx.appendChild(chips); }
    pFx.appendChild(scroll.querySelector(".foldBar"));
    pFx.appendChild(sections);
    const out = $("sec-output");
    if (out) { out.classList.add("static"); out.classList.remove("closed"); S.collapsed.output = false; pOut.appendChild(out); }
    secTpl.remove();

    function show(k, user) {
      S.ui.tab = k;
      TABS.forEach(([t]) => {
        $("tab-" + t).className = "segBtn" + (t === k ? " on" : "");
        $("panel-" + t).hidden = t !== k;
      });
      if (window.InkFluid) requestAnimationFrame(() => { InkFluid.refresh(); InkFluid.fillAll(); });
      if (user) { scroll.scrollTop = 0; saveState(); }
    }
    TABS.forEach(([k]) => $("tab-" + k).addEventListener("pointerdown", e => { if (e.button === 0) show(k, true); }));
    TABS.forEach(([k]) => $("tab-" + k).addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") show(k, true); }));
    TABS.forEach(([k]) => $("tab-" + k).tabIndex = 0);
    show(S.ui.tab && TABS.some(t => t[0] === S.ui.tab) ? S.ui.tab : "fx");

    // « Tout ouvrir / Tout replier / Actives » : sections d'effets uniquement
    window.setAllCollapsed = function (mode) {
      PR.SCHEMA.forEach(sec => {
        if (sec.id === "output") return;
        const want = mode === "all" ? true : mode === "none" ? false : !(sec.toggle ? S.params[sec.toggle] : false);
        if (!!S.collapsed[sec.id] !== want) toggleSection(sec.id);
      });
    };
    // cliquer une puce d'effet ouvre l'onglet Effets sur la bonne section
    const origOpen = window.openSection;
    window.openSection = function (id) { if (S.ui.tab !== "fx") show("fx", true); return origOpen.apply(this, arguments); };

    // sous-titre du style courant
    const sub = () => { const t = currentTpl(); $("curSub").textContent = t ? t.name + (isDirty() ? " · modifié" : "") : "réglages perso"; };
    const origDirty = window.updateDirty;
    window.updateDirty = function () { const r = origDirty.apply(this, arguments); sub(); return r; };
    sub();

    // le style choisi reste visible dans la bande
    const origGrid = window.renderTemplateGrid;
    // défile seulement la bande (scrollIntoView ferait aussi défiler une page parente, ex. la landing)
    const reveal = () => {
      const on = grid.querySelector(".tpl.on"); if (!on) return;
      const l = on.offsetLeft - grid.offsetLeft, r = l + on.offsetWidth;
      if (l < grid.scrollLeft || r > grid.scrollLeft + grid.clientWidth) grid.scrollTo({ left: Math.max(0, l - 12), behavior: "smooth" });
    };
    window.renderTemplateGrid = function () { const r = origGrid.apply(this, arguments); requestAnimationFrame(reveal); return r; };
    setTimeout(reveal, 300);

    document.body.classList.add("laid");
  }
  window.InkLayout = build;
  if (window.__inkBuilt) build();
})();

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
  window.InkFluid = { refresh: allSegs, fillAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  setTimeout(() => { allSegs(); fillAll(); }, 600);
})();
