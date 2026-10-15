/*
 * Fecha original de una fotografía a partir de sus metadatos EXIF (puro: recibe un ArrayBuffer con el archivo original,
 * antes de cualquier conversión, porque al convertir o comprimir se pierden los metadatos).
 *
 * Dónde se busca el bloque TIFF/EXIF:
 *   JPEG  segmento APP1 «Exif\0\0» (cámara del iPhone, la mayoría de cámaras y apps)
 *   HEIC  elemento «Exif» del contenedor ISO-BMFF (fotos del iPhone en formato de alta eficiencia): se localiza la
 *         cabecera «Exif\0\0» seguida de «II*\0» o «MM\0*»
 *   PNG   fragmento «eXIf» (poco común)
 * Campos (en ese orden de preferencia):
 *   DateTimeOriginal (0x9003)   cuándo se tomó la fotografía         → field 'DateTimeOriginal'
 *   DateTimeDigitized (0x9004)  cuándo se digitalizó (igual en cámaras) → field 'DateTimeDigitized'
 *   OffsetTimeOriginal (0x9011) / OffsetTimeDigitized (0x9012): zona horaria («-06:00») si la cámara la guardó
 * DateTime (0x0132) NO se usa: es la fecha de la última modificación del archivo, no de la toma.
 * Tampoco se usa file.lastModified. Si no hay un campo válido, el resultado no trae fecha.
 * → { capturedAt:'AAAA-MM-DDTHH:MM:SS'|null, offset:'-06:00'|null, field, make, model, software, format }
 */
const ascii = (dv, off, n) => { let s = ''; for (let i = 0; i < n && off + i < dv.byteLength; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); } return s; };

function findTiff(buf) {
  const dv = new DataView(buf), n = dv.byteLength;
  if (n < 12) return null;
  /* JPEG */
  if (dv.getUint16(0) === 0xFFD8) {
    let o = 2;
    while (o + 4 < n) {
      if (dv.getUint8(o) !== 0xFF) { o++; continue; }
      const mk = dv.getUint8(o + 1);
      if (mk === 0xD9 || mk === 0xDA) break;
      const len = dv.getUint16(o + 2);
      if (mk === 0xE1 && ascii(dv, o + 4, 4) === 'Exif' && dv.getUint16(o + 8) === 0) return { dv, start: o + 10, format: 'jpeg' };
      o += 2 + len;
    }
    return null;
  }
  /* PNG: fragmento eXIf */
  if (dv.getUint32(0) === 0x89504E47) {
    let o = 8;
    while (o + 8 < n) {
      const len = dv.getUint32(o), type = ascii(dv, o + 4, 4);
      if (type === 'eXIf') return { dv, start: o + 8, format: 'png' };
      if (type === 'IEND') break;
      o += 12 + len;
    }
    return null;
  }
  /* HEIC/HEIF y otros contenedores: cabecera Exif seguida de TIFF */
  const u8 = new Uint8Array(buf), lim = Math.min(n - 10, 4 * 1024 * 1024);
  for (let i = 0; i < lim; i++) {
    if (u8[i] === 0x45 && u8[i + 1] === 0x78 && u8[i + 2] === 0x69 && u8[i + 3] === 0x66 && u8[i + 4] === 0 && u8[i + 5] === 0) {
      const a = u8[i + 6], b = u8[i + 7];
      if ((a === 0x49 && b === 0x49 && u8[i + 8] === 0x2A) || (a === 0x4D && b === 0x4D && u8[i + 9] === 0x2A)) {
        const ft = ascii(dv, 4, 8);
        return { dv, start: i + 6, format: /ftyp(heic|heix|hevc|mif1|msf1|heif)/.test(ft) ? 'heic' : 'otro' };
      }
    }
  }
  return null;
}

function readIfd(dv, base, off, le, want) {
  const out = {};
  if (off <= 0 || base + off + 2 > dv.byteLength) return out;
  const cnt = dv.getUint16(base + off, le);
  for (let i = 0; i < cnt && i < 400; i++) {
    const e = base + off + 2 + i * 12;
    if (e + 12 > dv.byteLength) break;
    const tag = dv.getUint16(e, le);
    if (!want.has(tag)) continue;
    const type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
    if (type === 2) {
      const vo = count <= 4 ? e + 8 : base + dv.getUint32(e + 8, le);
      out[tag] = ascii(dv, vo, Math.min(count, 64)).trim();
    } else if (type === 4 || type === 13) out[tag] = dv.getUint32(e + 8, le);
  }
  return out;
}

/* «2026:10:12 14:32:05» → «2026-10-12T14:32:05» (null si está vacío, es 0000 o no es una fecha real) */
export function exifDate(s) {
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}
const okOffset = (s) => (/^[+-]\d{2}:\d{2}$/.test(String(s || '').trim()) ? String(s).trim() : null);

export function readExif(buf) {
  try {
    const t = findTiff(buf);
    if (!t) return { capturedAt: null, offset: null, field: null, format: null };
    const { dv, start } = t;
    const bo = dv.getUint16(start), le = bo === 0x4949;
    if (!le && bo !== 0x4D4D) return { capturedAt: null, offset: null, field: null, format: t.format };
    const ifd0 = readIfd(dv, start, dv.getUint32(start + 4, le), le, new Set([0x010F, 0x0110, 0x0131, 0x8769]));
    const ex = ifd0[0x8769] ? readIfd(dv, start, ifd0[0x8769], le, new Set([0x9003, 0x9004, 0x9011, 0x9012])) : {};
    let capturedAt = exifDate(ex[0x9003]), field = capturedAt ? 'DateTimeOriginal' : null, offset = capturedAt ? okOffset(ex[0x9011]) : null;
    if (!capturedAt) { capturedAt = exifDate(ex[0x9004]); if (capturedAt) { field = 'DateTimeDigitized'; offset = okOffset(ex[0x9012]); } }
    return { capturedAt, offset, field, make: ifd0[0x010F] || '', model: ifd0[0x0110] || '', software: ifd0[0x0131] || '', format: t.format };
  } catch (e) { return { capturedAt: null, offset: null, field: null, format: null, error: true }; }
}

/* Construye un JPEG mínimo con EXIF (para pruebas): fields { DateTimeOriginal, OffsetTimeOriginal, DateTime, Make } */
export function buildExifJpeg(fields = {}, le = true) {
  const tags0 = [], tagsEx = [];
  if (fields.Make) tags0.push([0x010F, fields.Make]);
  if (fields.DateTime) tags0.push([0x0132, fields.DateTime]);
  if (fields.DateTimeOriginal) tagsEx.push([0x9003, fields.DateTimeOriginal]);
  if (fields.DateTimeDigitized) tagsEx.push([0x9004, fields.DateTimeDigitized]);
  if (fields.OffsetTimeOriginal) tagsEx.push([0x9011, fields.OffsetTimeOriginal]);
  const bytes = []; const w16 = (v) => (le ? bytes.push(v & 255, v >> 8) : bytes.push(v >> 8, v & 255)); const w32 = (v) => (le ? bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24) : bytes.push(v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255));
  const ifd0Off = 8, n0 = tags0.length + 1, ifd0Size = 2 + n0 * 12 + 4;
  const exOff = ifd0Off + ifd0Size, nEx = tagsEx.length, exSize = 2 + nEx * 12 + 4;
  let dataOff = exOff + exSize; const data = [];
  const entry = (tag, val, list) => { const s = [...val].map((c) => c.charCodeAt(0)).concat(0); list.push({ tag, s }); };
  const e0 = [], eE = []; tags0.forEach(([t, v]) => entry(t, v, e0)); tagsEx.forEach(([t, v]) => entry(t, v, eE));
  bytes.push(...(le ? [0x49, 0x49] : [0x4D, 0x4D])); w16(42); w32(ifd0Off);
  const writeIfd = (entries, extra) => {
    w16(entries.length + (extra ? 1 : 0));
    for (const { tag, s } of entries) { w16(tag); w16(2); w32(s.length); if (s.length <= 4) { const p = s.concat([0, 0, 0, 0]).slice(0, 4); bytes.push(...p); } else { w32(dataOff); data.push(...s); dataOff += s.length; } }
    if (extra) { w16(0x8769); w16(4); w32(1); w32(exOff); }
    w32(0);
  };
  writeIfd(e0, true); writeIfd(eE, false);
  const tiff = bytes.concat(data);
  const app1 = [0xFF, 0xE1, (tiff.length + 8) >> 8, (tiff.length + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return new Uint8Array([0xFF, 0xD8, ...app1, 0xFF, 0xD9]).buffer;
}
