/**
 * INK LAB pour Google Slides
 * Colle ce fichier dans Extensions › Apps Script de ta présentation, enregistre, puis recharge la présentation.
 * Le volet est chargé depuis https://gvsxx.github.io/ink-lab-powerpoint/ : les mises à jour arrivent toutes seules.
 */
var INKLAB_URL = "https://gvsxx.github.io/ink-lab-powerpoint/gslides.html";
var INKLAB_TAG = "INKLAB:";

function onOpen(e) {
  SlidesApp.getUi().createMenu("Ink Lab")
    .addItem("Ouvrir Ink Lab", "inkLabOpen")
    .addToUi();
}
function onInstall(e) { onOpen(e); }

function inkLabOpen() {
  var html = UrlFetchApp.fetch(INKLAB_URL + "?t=" + Date.now(), { muteHttpExceptions: true }).getContentText();
  var out = HtmlService.createHtmlOutput(html).setTitle("Ink Lab").setSandboxMode(HtmlService.SandboxMode.IFRAME);
  SlidesApp.getUi().showSidebar(out);
}

/* ---------- Lecture de la sélection ---------- */
function inkLabSelection() {
  var sel = SlidesApp.getActivePresentation().getSelection();
  var type = sel.getSelectionType();
  var els = null;
  if (type == SlidesApp.SelectionType.PAGE_ELEMENT) els = sel.getPageElementRange().getPageElements();
  else if (type == SlidesApp.SelectionType.TEXT || type == SlidesApp.SelectionType.TABLE_CELL) {
    try { els = sel.getPageElementRange() ? sel.getPageElementRange().getPageElements() : null; } catch (e) { els = null; }
  }
  if (!els || !els.length) return { kind: "none" };
  var el = els[0];
  var box = { left: el.getLeft(), top: el.getTop(), width: el.getWidth(), height: el.getHeight() };
  var id = el.getObjectId();
  var t = el.getPageElementType();
  if (t == SlidesApp.PageElementType.IMAGE) {
    var desc = el.asImage().getDescription() || "";
    if (desc.indexOf(INKLAB_TAG) === 0) {
      var key = desc.slice(INKLAB_TAG.length);
      var raw = PropertiesService.getDocumentProperties().getProperty("inklab:" + key);
      return { kind: "ink", shapeId: id, key: key, box: box, data: raw ? JSON.parse(raw) : null };
    }
    return { kind: "other", shapeId: id, box: box };
  }
  if (t != SlidesApp.PageElementType.SHAPE) return { kind: "other", shapeId: id, box: box };
  var tr = el.asShape().getText();
  var text = tr.asString().replace(/\n$/, "");
  if (!text.trim()) return { kind: "other", shapeId: id, box: box };
  var st = tr.getTextStyle();
  var color = null;
  try { var fc = st.getForegroundColor(); if (fc && fc.getColorType() == SlidesApp.ColorType.RGB) color = fc.asRgbColor().asHexString(); } catch (e) { color = null; }
  var align = null;
  try {
    var a = tr.getParagraphStyle().getParagraphAlignment();
    align = a == SlidesApp.ParagraphAlignment.CENTER ? "center" : a == SlidesApp.ParagraphAlignment.END ? "right" : "left";
  } catch (e) { align = null; }
  return {
    kind: "text", shapeId: id, box: box, name: el.getTitle() || "",
    text: text.replace(/\u000b/g, "\n"),
    font: { name: st.getFontFamily(), size: st.getFontSize(), bold: !!st.isBold(), italic: !!st.isItalic(), color: color, caps: false },
    align: align
  };
}

/* ---------- Insertion de l'image ---------- */
function inkLabInsert(b64, rect, key, dataJson, deleteId) {
  var pres = SlidesApp.getActivePresentation();
  var page = pres.getSelection().getCurrentPage();
  if (!page) throw new Error("Ouvre une diapo avant d'insérer l'image.");
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), "image/png", "inklab.png");
  var img = page.insertImage(blob, rect.left, rect.top, rect.width, rect.height);
  img.setTitle("Ink Lab");
  img.setDescription(INKLAB_TAG + key);
  if (deleteId) { try { var old = page.getPageElementById(deleteId); if (old) old.remove(); } catch (e) { /* déjà supprimée */ } }
  try { PropertiesService.getDocumentProperties().setProperty("inklab:" + key, dataJson); } catch (e) { /* réglages trop lourds : l'image reste */ }
  img.select();
  return { shapeId: img.getObjectId() };
}
