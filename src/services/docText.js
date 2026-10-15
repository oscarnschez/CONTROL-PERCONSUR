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

/*
 * Prepara la imagen para el OCR (en una copia): la amplía hasta ~2600 px de ancho (las capturas de pantalla y fotos
 * pequeñas tienen letras de 8–10 px y el OCR confunde las diagonales de las fechas), escala de grises y más contraste.
 */
async function prepare(image) {
  let src = image, w, h, done = () => {};
  if (image instanceof Blob) {
    const u = URL.createObjectURL(image);
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo abrir la imagen')); im.src = u; });
    done = () => URL.revokeObjectURL(u);
    w = src.naturalWidth; h = src.naturalHeight;
  } else { w = image.width; h = image.height; }
  const k = Math.max(1, Math.min(4, 2600 / w));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height); done();
  const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 150));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return c;
}

/* OCR en español; onProgress(0–1) */
export async function ocr(image, onProgress) {
  const T = await script(OCR + 'tesseract.min.js', 'Tesseract');
  const worker = await T.createWorker('spa', 1, {
    workerPath: OCR + 'worker.min.js', corePath: OCR, langPath: OCR.replace(/\/$/, ''), gzip: true, workerBlobURL: false, cacheMethod: 'none',
    logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
  });
  try {
    const { data } = await worker.recognize(await prepare(image));
    return data.text || '';
  } finally { await worker.terminate(); }
}

/* Lee el texto de un PDF o imagen (se intenta primero el texto del PDF) */
export async function readText(blob, { kind, onStage } = {}) {
  try {
    if (kind === 'pdf') {
      onStage && onStage('Leyendo el texto del PDF…');
      const r = await pdfText(blob);
      if (r.text.replace(/\s/g, '').length >= 40) return { text: r.text, method: 'pdf-text', pages: r.pages };
      onStage && onStage('PDF escaneado: leyendo con OCR…');
      const c = await renderPage(r.pdf, 1, 2.2);
      const text = await ocr(c, (p) => onStage && onStage(`Leyendo con OCR… ${Math.round(p * 100)} %`));
      return { text, method: 'ocr', pages: r.pages };
    }
    onStage && onStage('Leyendo la imagen con OCR…');
    const text = await ocr(blob, (p) => onStage && onStage(`Leyendo con OCR… ${Math.round(p * 100)} %`));
    return { text, method: 'ocr', pages: 1 };
  } catch (e) {
    console.warn('lectura de documento', e);
    return { text: '', method: 'none', pages: 0, error: e.message || 'No se pudo leer el documento' };
  }
}
