/*
 * Texto de un documento para detectar datos (periodo del complemento de pago, póliza…). Todo se hace en el
 * dispositivo con librerías locales (/vendor), sin enviar el documento a ningún servicio:
 *   PDF con texto   PDF.js (vendor/pdfjs) lee el texto de las primeras páginas y rearma los renglones por posición.
 *   PDF escaneado   (casi sin texto) se dibuja la primera página y se lee con OCR.
 *   Imagen          OCR con Tesseract.js en español (vendor/ocr; se descarga la primera vez y queda en caché).
 * El archivo original nunca se modifica: se lee una copia en memoria.
 * → { text, method:'pdf-text'|'ocr'|'none', pages, error? }
 */
const PDFJS = './vendor/pdfjs/pdf.min.js', PDFJS_WORKER = './vendor/pdfjs/pdf.worker.min.js';
const OCR = './vendor/ocr/';

function script(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => (window[global] ? res(window[global]) : rej(new Error('No se pudo cargar ' + src)));
    s.onerror = () => { s.remove(); rej(new Error('No se pudo cargar ' + src)); };
    document.head.appendChild(s);
  });
}
export async function pdfjs() {
  const lib = await script(PDFJS, 'pdfjsLib');
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return lib;
}
/* Abre un PDF (para leer texto o dibujar páginas en el visor) */
export async function openPdf(blob) {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise;
}

/* Renglones a partir de las posiciones del texto (misma altura = mismo renglón; de izquierda a derecha) */
function linesOf(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5], x = it.transform[4];
    let r = rows.find((q) => Math.abs(q.y - y) < 2.5);
    if (!r) rows.push((r = { y, parts: [] }));
    r.parts.push({ x, s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
}

export async function pdfText(blob, maxPages = 3) {
  const pdf = await openPdf(blob);
  const out = [];
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const page = await pdf.getPage(i);
    out.push(linesOf((await page.getTextContent()).items));
  }
  return { text: out.join('\n'), pages: pdf.numPages, pdf };
}

/* Dibuja una página del PDF en un lienzo (visor y OCR de PDF escaneados) */
export async function renderPage(pdf, n, scale = 2) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

/* ===== OCR ===== */
async function sourceOf(image) {
  if (!(image instanceof Blob)) return { src: image, w: image.width, h: image.height, done: () => {} };
  const u = URL.createObjectURL(image);
  const src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo abrir la imagen')); im.src = u; });
  return { src, w: src.naturalWidth, h: src.naturalHeight, done: () => URL.revokeObjectURL(u) };
}
/*
 * Copia de una zona de la imagen preparada para el OCR (el original no se toca): ampliada k veces y en escala de
 * grises; mode 'c' = más contraste, número = blanco y negro con ese umbral.
 */
function crop(src, sx, sy, sw, sh, k, mode = 'c') {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = mode === 'c' ? Math.max(0, Math.min(255, (g - 128) * 1.6 + 150)) : g < mode ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return c;
}
async function newWorker(onProgress) {
  const T = await script(OCR + 'tesseract.min.js', 'Tesseract');
  return T.createWorker('spa', 1, {
    workerPath: OCR + 'worker.min.js', corePath: OCR, langPath: OCR.replace(/\/$/, ''), gzip: true, workerBlobURL: false, cacheMethod: 'none',
    logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
  });
}
/* Variantes para releer un renglón: las letras pequeñas se confunden distinto con cada preparación (5/6, J/I, B/8) */
const VARIANTS = [[2, 'c'], [2, 200], [3, 200], [3, 'c']];

/*
 * OCR de un documento: texto completo (imagen ampliada a ~2600 px de ancho, con más contraste) y, opcionalmente:
 *   refine  [{ key, re }]  renglones que se vuelven a leer con varias preparaciones (p. ej. número de póliza y serie);
 *                          → extra[key] = [textos] para elegir el valor más repetido o el que pasa su verificación
 *   header  true           recuadro del logotipo (esquina superior izquierda) leído aparte → header
 * → { text, extra, header }
 */
export async function ocrDocument(image, { onProgress, refine = [], header = false } = {}) {
  const { src, w, h, done } = await sourceOf(image);
  const worker = await newWorker(onProgress);
  try {
    const k = Math.max(1, Math.min(4, 2600 / w));
    const main = crop(src, 0, 0, w, h, k, 'c');
    const { data } = await worker.recognize(main, {}, { text: true, blocks: refine.length > 0 });
    const out = { text: data.text || '', extra: {}, header: '' };
    if (refine.length) {
      const lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
      for (const { key, re } of refine) {
        const ln = lines.find((l) => re.test(l.text || ''));
        if (!ln || !ln.bbox) continue;
        const { x0, y0, x1, y1 } = ln.bbox, pad = 6;
        const sx = Math.max(0, x0 / k - pad), sy = Math.max(0, y0 / k - pad), sw = Math.min(w - sx, (x1 - x0) / k + 2 * pad), sh = Math.min(h - sy, (y1 - y0) / k + 2 * pad);
        out.extra[key] = [];
        for (const [kk, mode] of VARIANTS) out.extra[key].push(((await worker.recognize(crop(src, sx, sy, sw, sh, kk, mode))).data.text || '').trim());
      }
    }
    if (header) {
      const texts = [];
      for (const [fw, fh] of [[0.32, 0.13], [0.5, 0.2]]) texts.push(((await worker.recognize(crop(src, 0, 0, w * fw, Math.min(h, w * fh), 3, 'c'))).data.text || '').trim());
      out.header = texts.join('\n');
    }
    return out;
  } finally { done(); await worker.terminate(); }
}
/* OCR en español; onProgress(0–1) → texto */
export async function ocr(image, onProgress) { return (await ocrDocument(image, { onProgress })).text; }

/* Logotipo de la primera página de un PDF (cuando el texto del PDF no trae el nombre de la aseguradora) → texto */
export async function ocrHeader(blob) {
  try {
    const c = await renderPage(await openPdf(blob), 1, 2.5);
    return (await ocrDocument(c, { header: true })).header;
  } catch (e) { console.warn('encabezado', e); return ''; }
}

/*
 * Lee el texto de un PDF o imagen (se intenta primero el texto del PDF).
 * refine / header: ver ocrDocument (solo cuando se usa OCR; en un PDF con texto, header se lee si needHeader(texto)).
 * → { text, method:'pdf-text'|'ocr'|'none', pages, extra, header, error? }
 */
export async function readText(blob, { kind, onStage, refine = [], header = false, needHeader = null } = {}) {
  const prog = (p) => onStage && onStage(`Leyendo con OCR… ${Math.round(p * 100)} %`);
  try {
    if (kind === 'pdf') {
      onStage && onStage('Leyendo el texto del PDF…');
      const r = await pdfText(blob);
      if (r.text.replace(/\s/g, '').length >= 40) {
        let head = '';
        if (header && needHeader && needHeader(r.text)) { onStage && onStage('Leyendo el logotipo…'); head = await ocrHeader(blob); }
        return { text: r.text, method: 'pdf-text', pages: r.pages, extra: {}, header: head };
      }
      onStage && onStage('PDF escaneado: leyendo con OCR…');
      const o = await ocrDocument(await renderPage(r.pdf, 1, 2.2), { onProgress: prog, refine, header });
      return { ...o, method: 'ocr', pages: r.pages };
    }
    onStage && onStage('Leyendo la imagen con OCR…');
    const o = await ocrDocument(blob, { onProgress: prog, refine, header });
    return { ...o, method: 'ocr', pages: 1 };
  } catch (e) {
    console.warn('lectura de documento', e);
    return { text: '', method: 'none', pages: 0, extra: {}, header: '', error: e.message || 'No se pudo leer el documento' };
  }
}
