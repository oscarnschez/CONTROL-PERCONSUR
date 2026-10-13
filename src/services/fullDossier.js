/*
 * Expediente de una carga de Control de llenos = sus documentos con archivo, en el orden del expediente
 * (pedimento, DODA, cita, DEC y adicionales, o el orden que el usuario guardó) y solo los que eligió incluir.
 * Es un archivo DERIVADO: se arma al pedirlo con los archivos vigentes; los originales nunca se modifican.
 * Usa pdf-lib (vendor) y appendFile() de services/pdf.js: las páginas de los PDF se copian tal cual y las imágenes se
 * colocan centradas en una página carta con su orientación. Se procesa un archivo a la vez para cuidar la memoria del iPhone.
 */
import { loadLib } from './libs.js';
import * as media from './media.js';
import { appendFile } from './pdf.js';
import { docsOf, missingFiles } from './fulls.js';
import { dossierDocs, dossierFilename, docLabel } from '../domain/fulls/fulls.js';

/* Por encima de esto se avisa antes de combinar (no se bloquea) */
export const HEAVY_BYTES = 60 * 1024 * 1024;

/* Resumen previo (sin combinar): secciones con sus páginas, tamaño estimado y lo que se omitirá */
export async function dossierPlan(load) {
  const d = dossierDocs(docsOf(load.id), load), missing = await missingFiles(load.id);
  const sections = [], unavailable = [];
  let page = 1, bytes = 0;
  for (const doc of d.included) {
    if (missing.has(doc.id)) { unavailable.push(doc); continue; }
    const n = doc.pages || 1;
    sections.push({ key: doc.id, doc, label: docLabel(doc), name: doc.name, kind: doc.kind, from: page, to: page + n - 1 });
    page += n; bytes += doc.size || 0;
  }
  return { all: d.all, sections, excluded: d.skipped, unavailable, missing, pages: page - 1, bytes };
}

/*
 * Combina en un solo PDF. onProgress(i, total, nombre). Devuelve { file, pages, sections, skipped:[etiquetas] }.
 * Un archivo que falla al combinar se omite y se informa; no cancela el expediente.
 */
export async function buildDossier(load, { onProgress } = {}) {
  await loadLib('pdflib');
  const { PDFDocument } = window.PDFLib;
  const plan = await dossierPlan(load);
  const out = await PDFDocument.create();
  const total = plan.sections.length, sections = [], skipped = plan.unavailable.map((d) => docLabel(d));
  let done = 0;
  for (const s of plan.sections) {
    onProgress && onProgress(++done, total, s.label);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const blob = await media.getBlob(s.doc.storageKey);
      if (!blob) throw new Error('Archivo no disponible');
      const from = out.getPageCount() + 1;
      let bytes = new Uint8Array(await blob.arrayBuffer());
      await appendFile(out, s.kind === 'img' ? { kind: 'img', bytes, w: s.doc.w, h: s.doc.h } : { kind: 'pdf', bytes });
      bytes = null;   /* libera la copia temporal antes del siguiente archivo */
      sections.push({ ...s, from, to: out.getPageCount() });
    } catch (e) { console.warn('expediente', s.label, e); skipped.push(s.label); }
  }
  if (!out.getPageCount()) throw new Error('No hay documentos que se puedan combinar.');
  out.setTitle(`Expediente lleno ${load.containerNumber}`); out.setAuthor('PERCONSUR'); out.setCreator('PERCONSUR'); out.setSubject(`Carga programada ${load.scheduledDate} ${load.scheduledTime || ''}`.trim());
  const name = dossierFilename(load);
  const file = new File([await out.save()], name, { type: 'application/pdf' });
  return { file, pages: out.getPageCount(), sections, skipped };
}
