/* INK LAB — hôte « PowerPoint » (complément Office.js, volet Office).
   Lit la zone de texte sélectionnée, insère le rendu en image PNG sur la diapo,
   et garde texte + réglages dans le fichier pour pouvoir modifier l'image plus tard. */
(function () {
  const PX_PER_PT = 4;              // rendu « Standard » : 4 px par point (≈ 288 ppp)
  const TAG = "INKLAB";
  const sel = { kind: "none", shapeId: null, key: null, box: null, font: null };
  let ready = false, reading = false, readAgain = false;

  const H = window.HOST = {
    outputTitle: "Insertion",
    outputSub: "image PNG sur la diapo",
    textSub: "lu depuis la zone sélectionnée",
    hideSize: true,
    applyLabel: () => sel.kind === "ink" ? "Mettre à jour l'image" : "Insérer dans la diapo",
    emptyMessage: () => "Sélectionne une zone de texte dans ta diapo, ou tape un texte ici.",
    extraFont: () => sel.font,
    refresh: () => readSelection(false),
    outputHTML() {
      return `<div class="lbl" style="margin-top:2px">Qualité de l'image</div>
        <div class="seg"><div class="segBtn" id="pq-1">Standard</div><div class="segBtn" id="pq-2">HD</div><div class="segBtn" id="pq-3">Ultra</div></div>
        <div class="note" id="pqNote"></div>
        <div class="ckRow"><label class="ck"><input type="checkbox" id="pq-replace" /> Supprimer la zone de texte d'origine (le texte reste modifiable dans Ink Lab)</label></div>
        <div class="ckRow"><label class="ck"><input type="checkbox" id="pq-bg" /> Inclure le fond dans l'image</label></div>
        <div class="note">Pour corriger le texte plus tard : clique sur l'image Ink Lab dans la diapo, modifie le texte ou l'effet ici, puis « Mettre à jour l'image ».</div>`;
    },
    updateOutputUI() {
      const q = S.ui.pptQuality || 1;
      [1, 2, 3].forEach(v => { const b = $("pq-" + v); if (b) b.className = "segBtn" + (q === v ? " on" : ""); });
      const r = $("pq-replace"); if (r) r.checked = S.ui.pptReplace !== false;
      const b = $("pq-bg"); if (b) b.checked = S.ui.exportBg != null ? !!S.ui.exportBg : !!S.params.addBg;
      const n = $("pqNote"); if (n) n.textContent = ["", "4 px par point : net en plein écran.", "6 px par point : pour les grands écrans.", "8 px par point : impression, très gros titres (plus lent)."][q];
    },
    wireOutput() {
      [1, 2, 3].forEach(v => $("pq-" + v).addEventListener("click", () => { S.ui.pptQuality = v; H.updateOutputUI(); saveState(); }));
      $("pq-replace").addEventListener("change", e => { S.ui.pptReplace = !!e.target.checked; saveState(); });
      $("pq-bg").addEventListener("change", e => { S.ui.exportBg = !!e.target.checked; saveState(); });
    },
    async saveFile(name, data) {   // export de templates : copie dans le presse-papiers (pas de téléchargement dans Office)
      try { await navigator.clipboard.writeText(typeof data === "string" ? data : ""); status("Contenu de « " + name + " » copié dans le presse-papiers.", "ok"); return true; }
      catch (e) { status("Export impossible dans PowerPoint : utilise la version web d'Ink Lab.", "err"); return false; }
    },
    async apply() { return insertOrUpdate(); },
    init() {
      return new Promise(resolve => {
        if (!window.Office) { status("Office.js introuvable : ouvre ce volet depuis PowerPoint.", "err"); resolve(); return; }
        Office.onReady(info => {
          if (info.host !== Office.HostType.PowerPoint) { status("Ce complément fonctionne dans PowerPoint.", "err"); resolve(); return; }
          ready = true;
          if (!Office.context.requirements.isSetSupported("PowerPointApi", "1.5")) {
            setBanner("info", "Ta version de PowerPoint est trop ancienne pour lire la sélection. Mets PowerPoint à jour (Microsoft 365) ; en attendant, tape ton texte dans Ink Lab.", []);
          }
          Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => {
            clearTimeout(H._st); H._st = setTimeout(() => readSelection(true), 250);
          });
          readSelection(true).then(resolve, resolve);
        });
      });
    }
  };

  /* ---------- Réglages enregistrés dans la présentation ---------- */
  function settingsGet(key) { try { return Office.context.document.settings.get("inklab:" + key) || null; } catch (e) { return null; } }
  function settingsSet(key, val) {
    return new Promise(res => {
      try {
        if (val == null) Office.context.document.settings.remove("inklab:" + key); else Office.context.document.settings.set("inklab:" + key, val);
        Office.context.document.settings.saveAsync(() => res());
      } catch (e) { res(); }
    });
  }

  /* ---------- Lecture de la sélection ---------- */
  const ALIGN = { Left: "left", Center: "center", Right: "right", Justify: "left", JustifyLow: "left", Distributed: "center", ThaiDistributed: "center" };
  async function readSelection(silent) {
    if (!ready || !Office.context.requirements.isSetSupported("PowerPointApi", "1.5")) return;
    if (S.applying) return;
    if (reading) { readAgain = true; return; }
    reading = true;
    try {
      await PowerPoint.run(async ctx => {
        const shapes = ctx.presentation.getSelectedShapes();
        shapes.load("items/id,items/name,items/type,items/left,items/top,items/width,items/height");
        await ctx.sync();
        if (!shapes.items.length) { setSel({ kind: "none" }); return; }
        const sh = shapes.items[0];
        const tags = sh.tags; tags.load("items/key,items/value");
        await ctx.sync();
        const tag = tags.items.find(t => t.key === TAG);
        const box = { left: sh.left, top: sh.top, width: sh.width, height: sh.height };
        if (tag) {
          const data = settingsGet(tag.value);
          setSel({ kind: "ink", shapeId: sh.id, key: tag.value, box, data });
          return;
        }
        let tr = null;
        try {
          tr = sh.textFrame.textRange;
          tr.load("text");
          tr.font.load("name,size,bold,italic,color,allCaps");
          tr.paragraphFormat.load("horizontalAlignment");
          await ctx.sync();
        } catch (e) { tr = null; }
        if (!tr || !String(tr.text || "").trim()) { setSel({ kind: "other", shapeId: sh.id, box }); return; }
        const f = tr.font;
        setSel({
          kind: "text", shapeId: sh.id, box, name: sh.name,
          text: String(tr.text).replace(/\r\n?|\v|\u000b/g, "\n"),
          font: { name: f.name || null, size: f.size || null, bold: !!f.bold, italic: !!f.italic, color: f.color || null, caps: !!f.allCaps },
          align: ALIGN[tr.paragraphFormat.horizontalAlignment] || null
        });
      });
    } catch (e) { if (!silent) status("Lecture de la sélection impossible : " + (e.message || e), "err"); console.log(e); }
    finally {
      reading = false;
      if (readAgain) { readAgain = false; readSelection(true); }
    }
  }

  function setSel(s) {
    const prevKind = sel.kind, prevId = sel.shapeId;
    Object.assign(sel, { kind: "none", shapeId: null, key: null, box: null, data: null }, s);
    const blur = () => { const a = document.activeElement; if (a && a.blur && /^(TEXTAREA|INPUT)$/.test(a.tagName)) a.blur(); };
    if (s.kind === "text") {
      sel.font = s.font.name;
      if (prevKind === "text" && prevId === s.shapeId && S.text.text === s.text) { updateApplyLabel(); return; }
      blur();
      const T = S.text;
      T.text = s.text;
      if (s.font.name) T.family = s.font.name;
      if (s.font.size) T.size = Math.round(s.font.size * PX_PER_PT);
      T.weight = s.font.bold ? 700 : 400;
      T.italic = s.font.italic;
      T.upper = s.font.caps;
      if (s.font.color && /^#[0-9a-f]{6}$/i.test(s.font.color)) T.color = s.font.color.toUpperCase();
      if (s.align) T.align = s.align;
      syncTextUI(); saveState(); scheduleSource();
      setBanner("edit", "Zone de texte « " + esc(s.name || "") + " » : " + esc(s.font.name || "police mixte") + (s.font.size ? " · " + s.font.size + " pt" : "") + ". Choisis un effet puis insère l'image.", []);
      logOp("Zone de texte lue (" + (s.font.name || "?") + ", " + (s.font.size || "?") + " pt)");
    } else if (s.kind === "ink") {
      if (s.data && !(prevKind === "ink" && prevId === s.shapeId)) {
        blur();
        if (s.data.text) S.text = Object.assign({}, TEXT_DEFAULTS, s.data.text);
        if (s.data.params) { S.params = Object.assign({}, PR.DEFAULTS, s.data.params); S.currentId = s.data.tplId && S.templates.some(t => t.id === s.data.tplId) ? s.data.tplId : null; }
        sel.font = S.text.family;
        $("tplName").value = currentTpl() ? currentTpl().name : "";
        syncTextUI(); afterBulkChange(); scheduleSource();
        logOp("Image Ink Lab sélectionnée : réglages rechargés");
      }
      setBanner("edit", s.data ? "Image Ink Lab sélectionnée : modifie le texte ou l'effet, puis « Mettre à jour l'image »."
        : "Image Ink Lab sélectionnée, mais ses réglages sont introuvables dans ce fichier : tu peux en refaire une nouvelle.", []);
    } else if (s.kind === "other") {
      setBanner("info", "Cette forme ne contient pas de texte. Sélectionne une zone de texte, ou tape le texte dans Ink Lab.", []);
    } else setBanner(null);
    updateApplyLabel();
  }

  /* ---------- Insertion ---------- */
  function insertImage(b64, rect) {
    return new Promise((res, rej) => {
      Office.context.document.setSelectedDataAsync(b64, {
        coercionType: Office.CoercionType.Image,
        imageLeft: rect.left, imageTop: rect.top, imageWidth: rect.width, imageHeight: rect.height
      }, r => r.status === Office.AsyncResultStatus.Succeeded ? res() : rej(new Error(r.error && r.error.message || "insertion refusée")));
    });
  }
  async function insertOrUpdate() {
    if (S.applying) return;
    if (!ready) { status("Ouvre Ink Lab depuis PowerPoint pour insérer l'image.", "err"); return; }
    if (!S.src) { status("Sélectionne une zone de texte ou tape un texte.", "err"); return; }
    S.applying = true; const btn = $("btnApply"); btn.classList.add("busy");
    const target = Object.assign({}, sel);
    try {
      const q = S.ui.pptQuality || 1, mul = [1, 1.5, 2][q - 1];
      status("Rendu de l'image…", "busy");
      await new Promise(r => setTimeout(r, 30));
      const bgOn = S.ui.exportBg != null ? !!S.ui.exportBg : !!S.params.addBg;
      const r = await renderFull(mul, { background: bgOn && eff(S.params).addBg });
      const b64 = r.canvas.toDataURL("image/png").split(",")[1];
      // taille en points (le texte garde la taille qu'il avait dans la diapo)
      const ptPerPx = 1 / (PX_PER_PT * mul);
      const w = r.w * ptPerPx, h = r.h * ptPerPx;
      let cx, cy;
      if (target.box) { cx = target.box.left + target.box.width / 2; cy = target.box.top + target.box.height / 2; }
      else { cx = 480; cy = 270; }
      // le centre du texte (et non de l'image, qui contient les marges des effets) va au centre de la zone
      const rect = { left: cx - r.center.x * ptPerPx, top: cy - r.center.y * ptPerPx, width: w, height: h };
      const key = target.kind === "ink" && target.key ? target.key : "k" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

      let before = [];
      await PowerPoint.run(async ctx => {
        const shp = ctx.presentation.getSelectedSlides().getItemAt(0).shapes; shp.load("items/id"); await ctx.sync();
        before = shp.items.map(x => x.id);
        try { ctx.presentation.setSelectedShapes([]); await ctx.sync(); } catch (e) { /* ancienne version */ }
      });
      await insertImage(b64, rect);
      await PowerPoint.run(async ctx => {
        const shp = ctx.presentation.getSelectedSlides().getItemAt(0).shapes;
        shp.load("items/id,items/name,items/type");
        await ctx.sync();
        const pic = shp.items.filter(x => before.indexOf(x.id) < 0).pop() || null;
        if (pic) { pic.tags.add(TAG, key); pic.name = "Ink Lab · " + String(S.text.text).replace(/\s+/g, " ").slice(0, 40); }
        const slide = ctx.presentation.getSelectedSlides().getItemAt(0);
        if (target.kind === "ink" && target.shapeId) { try { slide.shapes.getItem(target.shapeId).delete(); } catch (e) { /* déjà supprimée */ } }
        if (target.kind === "text" && target.shapeId && S.ui.pptReplace !== false) { try { slide.shapes.getItem(target.shapeId).delete(); } catch (e) { /* ignore */ } }
        await ctx.sync();
        if (pic) { sel.shapeId = pic.id; try { ctx.presentation.setSelectedShapes([pic.id]); await ctx.sync(); } catch (e) { /* ignore */ } }
        else logOp("Image insérée, mais introuvable pour l'étiqueter : elle ne pourra pas être mise à jour", "err");
      });
      await settingsSet(key, { text: S.text, params: S.params, tplId: S.currentId, v: 1 });
      Object.assign(sel, { kind: "ink", key, data: { text: S.text, params: S.params } });
      logOp((target.kind === "ink" ? "Image mise à jour" : "Image insérée") + " · " + r.w + "×" + r.h + " px");
      status(target.kind === "ink" ? "Image Ink Lab mise à jour." : "Image insérée dans la diapo.", "ok");
      setBanner("edit", "Image Ink Lab sélectionnée : modifie le texte ou l'effet, puis « Mettre à jour l'image ».", []);
    } catch (e) { status("Insertion impossible : " + (e.message || e), "err"); console.log(e); }
    finally { S.applying = false; btn.classList.remove("busy"); updateApplyLabel(); }
  }
})();
