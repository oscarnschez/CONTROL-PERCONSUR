/*
 * Póliza de seguro — lectura de datos (puro: recibe el texto ya extraído del PDF o por OCR; ver services/docText.js).
 *
 * Formato de referencia (BBVA Seguros, «PÓLIZA DE SEGURO FLOTILLAS», captura real del usuario):
 *   DATOS DE LA PÓLIZA
 *     Número de Póliza: 736A53045A          Número de Certificado: 736A530455   ← el certificado NO es la póliza
 *     Fecha de Emisión: 06/03/2026                                             ← emisión, no es vigencia
 *     Inicio de Vigencia de la póliza            Fin de vigencia de la póliza
 *     Desde las 12 :00 hrs del 06/03/2026        Hasta las 12 :00 hrs del 06/03/2027   ← VIGENCIA DE LA PÓLIZA
 *     Inicio de Vigencia del Inciso / Fin de vigencia del Inciso (mismo formato; solo si falta la de la póliza)
 *   DATOS DEL BIEN ASEGURADO
 *     Descripción: INTERNATIONAL LT625 … TRACTOCAMION
 *     Modelo: 2018                                ← año de la unidad
 *     Serie: 3HSDZAPR8JN566554                    ← número de serie (VIN/NIV, 17 caracteres)
 *   Aseguradora: el logotipo de la esquina superior izquierda («BBVA Seguros»). En un PDF el logotipo suele ser una
 *   imagen sin texto: la app lee con OCR ese recuadro (services/docText.js → ocrHeader) y aquí se reconoce el nombre.
 * Las etiquetas y sus valores pueden venir en el mismo renglón o en el siguiente (tablas). Nada se guarda sin que la
 * persona lo confirme; si un dato no aparece, se deja vacío (no se inventa).
 */
import { cleanText, findRanges } from './complement.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const p2 = (n) => String(n).padStart(2, '0');
function ymd(d, m, y) {
  d = +d; m = +m; y = +y; if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${y}-${p2(m)}-${p2(d)}`, t = new Date(s + 'T00:00:00Z');
  return t.getUTCDate() === d ? s : null;
}

/* Aseguradoras que operan en México (nombre para mostrar y cómo reconocerlas, también con errores comunes de OCR) */
export const INSURERS = [
  ['BBVA Seguros', /\bb\s?b\s?v\s?[a4\\/]\b|\bbbva\b|\bb?bva\b[\s\S]{0,60}\bseguros\b/], ['GNP Seguros', /\bgnp\b|grupo nacional provincial/], ['Quálitas', /\bqualitas\b/],
  ['AXA Seguros', /\baxa\b/], ['Chubb Seguros', /\bchubb\b/], ['HDI Seguros', /\bhdi\b/], ['MAPFRE', /\bmapfre\b/], ['Zurich', /\bzurich\b/],
  ['Seguros Inbursa', /\binbursa\b/], ['Seguros Banorte', /\bbanorte\b/], ['Afirme Seguros', /\bafirme\b/], ['Seguros Atlas', /seguros atlas/],
  ['ANA Seguros', /\bana seguros\b|\bana compania de seguros/], ['Allianz', /\ballianz\b/], ['Seguros El Potosí', /el potosi/],
  ['General de Seguros', /general de seguros/], ['Primero Seguros', /primero seguros/], ['Seguros SURA', /\bsura\b/], ['Seguros Ve por Más', /ve por mas/],
  ['Seguros Monterrey New York Life', /new york life/], ['Thona Seguros', /\bthona\b/], ['Assurant', /\bassurant\b/],
];
export function insurerOf(text) {
  const f = fold(text);
  for (const [name, re] of INSURERS) if (re.test(f)) return name;
  return '';
}

/* VIN/NIV: 17 caracteres sin I, O ni Q. En texto de OCR se corrigen O→0, I→1 y Q→0. ok = dígito verificador correcto */
const VAL = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const W = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
export function vinCheck(vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  const sum = [...vin].reduce((a, c, i) => a + (/\d/.test(c) ? +c : VAL[c]) * W[i], 0) % 11;
  return vin[8] === (sum === 10 ? 'X' : String(sum));
}
/*
 * El mejor VIN entre varias lecturas (texto del PDF o relecturas de OCR del mismo renglón).
 * Candidatos: cada lectura y sus variantes con a lo más 2 correcciones típicas de OCR (un carácter de más, O/Q→0,
 * I→1 o J, B↔8, S↔5, Z↔2, G↔6) que tengan dígito verificador correcto. Gana el candidato más cercano a TODAS las
 * lecturas (suma de distancias de edición), así una variante que pasa la verificación por azar no gana.
 * → { vin, ok } (ok = dígito verificador correcto)
 */
const SWAP = { O: ['0'], Q: ['0'], I: ['1', 'J'], L: ['1'], J: ['I'], B: ['8'], '8': ['B'], S: ['5'], '5': ['S'], Z: ['2'], '2': ['Z'], G: ['6'], '6': ['G'] };
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function edits(s, budget) {
  const out = new Set([s]);
  let frontier = [s];
  for (let k = 0; k < budget; k++) {
    const next = [];
    for (const x of frontier) {
      if (x.length > 17) for (let i = 0; i < x.length; i++) next.push(x.slice(0, i) + x.slice(i + 1));
      for (let i = 0; i < x.length; i++) for (const r of SWAP[x[i]] || []) next.push(x.slice(0, i) + r + x.slice(i + 1));
    }
    frontier = next.filter((x) => !out.has(x)); frontier.forEach((x) => out.add(x));
  }
  return [...out];
}
export function bestVin(raws) {
  const rs = raws.map((r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter((r) => r.length >= 16).map((r) => r.slice(0, 19));
  if (!rs.length) return { vin: '', ok: false };
  /* Fuerza: 3 = la lectura tal cual; 2 = solo quitar o cambiar letras que un VIN no puede tener (I, O, Q); 1 = otras correcciones */
  const cands = new Map();
  const add = (v, k) => { if (v.length === 17 && vinCheck(v) && (cands.get(v) || 0) < k) cands.set(v, k); };
  for (const r of rs) {
    add(r.slice(0, 17), 3);
    const fixed = r.replace(/[OQ]/g, '0').replace(/I/g, '1');
    add(fixed.slice(0, 17), 2);
    for (let i = 0; i < r.length; i++) if (/[IOQ]/.test(r[i])) add((r.slice(0, i) + r.slice(i + 1)).slice(0, 17), 2);
    for (const L of [17, 18, 19]) if (r.length >= L) for (const v of edits(r.slice(0, L), 2)) add(v, 1);
  }
  const near = (c, r) => [17, 18, 19].some((L) => r.length >= L && lev(r.slice(0, L), c) <= 1);
  let best = null, bv = -1, bk = 0;
  for (const [c, k] of cands) {
    const votes = rs.filter((r) => near(c, r)).length;
    if (votes > bv || (votes === bv && k > bk)) { best = c; bv = votes; bk = k; }
  }
  /* Una corrección sin respaldo (una sola lectura y no es una letra imposible) puede pasar la verificación por azar: no se acepta */
  if (best && (bk >= 2 || bv >= 2)) return { vin: best, ok: true };
  return { vin: cleanVin(rs[0]).slice(0, 17), ok: false };
}
export const cleanVin = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/Q/g, '0');

/* Valor que sigue a una etiqueta, en el mismo renglón o (si la tabla separa encabezados y valores) en el siguiente */
function afterLabel(lines, labelRe, valueRe) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], m = labelRe.exec(L);
    if (!m) continue;
    const rest = L.slice(m.index + m[0].length), v = valueRe.exec(rest);
    if (v) return v;
    const nx = lines[i + 1] && valueRe.exec(lines[i + 1]);
    if (nx) return nx;
  }
  return null;
}

/*
 * → { policyNumber, insurer, validFrom, validUntil, vigenciaDe:'póliza'|'inciso'|'texto'|null, issueDate, year, vin, vinOk,
 *     description, found:[campos encontrados], evidence:{campo:texto} }
 */
export function extractPolicy(text, opts = {}) {
  opts = { extra: {}, header: '', ...opts };
  const t = cleanText(text);
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const out = { policyNumber: '', insurer: insurerOf(opts.header) || insurerOf(t), validFrom: null, validUntil: null, vigenciaDe: null, issueDate: null, year: '', vin: '', vinOk: false, description: '', evidence: {} };
  /* Número de póliza (nunca el «Número de Certificado»). Con OCR se compara con las relecturas del renglón y gana el
     valor que más se repite (el OCR a veces lee 5 por 6 o separa un dígito) */
  const POL_LABEL = /(?:n[uú]mero|no\.?|num\.?)\s*de\s*p[oó]liza\s*:?|p[oó]liza\s*(?:no\.?|n[uú]m\.?|n[uú]mero)\s*:?/i;
  const POL_VALUE = /^\s*[:|]?\s*([A-Z0-9](?:[A-Z0-9-]| (?=\d))+)/i;
  const polOf = (txt) => { const ls = cleanText(txt).split('\n').map((x) => x.trim()).filter(Boolean); const m = afterLabel(ls, POL_LABEL, POL_VALUE); const v = m ? m[1].replace(/\s+/g, '').toUpperCase() : ''; return v.length >= 5 && /\d/.test(v) ? v : ''; };
  const polMain = polOf(t);
  const polCands = [polMain, ...(opts.extra.policy || []).map(polOf)].filter(Boolean);
  if (polCands.length) {
    const n = {}; polCands.forEach((c) => { n[c] = (n[c] || 0) + 1; });
    out.policyNumber = Object.keys(n).sort((a, b) => n[b] - n[a] || (b === polMain) - (a === polMain))[0];
    out.evidence.policyNumber = polCands.length > 1 ? `${out.policyNumber} (${n[out.policyNumber]} de ${polCands.length} lecturas)` : out.policyNumber;
  }
  /* Fecha de emisión (solo informativa) */
  const em = /fecha\s*de\s*emisi[oó]n\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i.exec(t);
  if (em) out.issueDate = ymd(em[1], em[2], em[3]);
  /* Vigencia: «Desde las 12:00 hrs del 06/03/2026» … «Hasta las 12:00 hrs del 06/03/2027» */
  const F = (re) => { const m = re.exec(t); return m ? { d: ymd(m[1], m[2], m[3]), at: m.index, raw: m[0] } : null; };
  const desde = [...t.matchAll(/desde\s+(?:las\s+)?[\d\s:]*(?:hrs?\.?|horas)?\s*(?:del?\s+)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/gi)].map((m) => ({ d: ymd(m[1], m[2], m[3]), at: m.index, raw: m[0] }));
  const hasta = [...t.matchAll(/hasta\s+(?:las\s+)?[\d\s:]*(?:hrs?\.?|horas)?\s*(?:del?\s+)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/gi)].map((m) => ({ d: ymd(m[1], m[2], m[3]), at: m.index, raw: m[0] }));
  const incisoAt = fold(t).search(/vigencia del inciso/), polizaAt = fold(t).search(/vigencia de la poliza/);
  /* La de la póliza: las primeras «desde/hasta» antes de la sección del inciso (o las únicas) */
  const pick = (arr) => arr.filter((x) => x.d).find((x) => incisoAt < 0 || x.at < incisoAt || polizaAt < 0) || null;
  let d1 = pick(desde), d2 = pick(hasta);
  if (d1 && d2) { out.vigenciaDe = polizaAt >= 0 && (incisoAt < 0 || d1.at < incisoAt) ? 'póliza' : 'inciso'; }
  else {
    d1 = desde.find((x) => x.d); d2 = hasta.find((x) => x.d);
    if (d1 && d2) out.vigenciaDe = 'inciso';
    else {
      /* Otros formatos: «Vigencia: 06/03/2026 al 06/03/2027» */
      const r = findRanges(t).filter((x) => x.span > 0 && x.span <= 400 && x.label >= 3)[0];
      if (r) { d1 = { d: r.from, raw: r.raw }; d2 = { d: r.to, raw: r.raw }; out.vigenciaDe = 'texto'; }
    }
  }
  if (d1 && d2 && d1.d && d2.d && d1.d < d2.d) { out.validFrom = d1.d; out.validUntil = d2.d; out.evidence.vigencia = `${d1.raw.replace(/\s+/g, ' ')} … ${d2.raw.replace(/\s+/g, ' ')}`; }
  /* Año: «Modelo: 2018» (en Datos del bien asegurado) */
  const maxY = new Date().getFullYear() + 2;
  const yr = afterLabel(lines, /\b(?:modelo|a[nñ]o\s*(?:modelo)?)\s*:?/i, /^\s*:?\s*((?:19[89]|20[0-9])\d)\b/);
  if (yr && +yr[1] <= maxY) { out.year = yr[1]; out.evidence.year = yr[0].trim(); }
  /* Número de serie: «Serie: 3HSDZAPR8JN566554» (VIN de 17 caracteres) */
  /* Número de serie: lecturas del renglón «Serie:»; gana la que tiene dígito verificador correcto */
  const vinRaws = [];
  const serieOf = (txt) => {
    const ls = cleanText(txt).split('\n').map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < ls.length; i++) {
      const m = /\b(?:n[uú]mero\s*de\s*)?(?:se(?:r|n)[il]?e|vin|niv)\s*:?/i.exec(ls[i]);
      if (!m) continue;
      for (const src of [ls[i].slice(m.index + m[0].length), ls[i + 1] || '']) {
        const tok = (src.match(/[A-Z0-9.]{3,}(?:\s?[A-Z0-9.]{2,})*/gi) || []).map((x) => x.replace(/[\s.]/g, '')).find((x) => x.length >= 16);
        if (tok) return tok;
      }
    }
    return '';
  };
  for (const txt of [t, ...(opts.extra.vin || [])]) { const r = serieOf(txt); if (r) vinRaws.push(r); }
  /* Sin etiqueta legible: cualquier código de 17 caracteres con dígito verificador correcto */
  vinRaws.push(...(t.toUpperCase().match(/\b[A-Z0-9]{17,18}\b/g) || []));
  const bv = bestVin(vinRaws);
  if (bv.vin) { out.vin = bv.vin; out.vinOk = bv.ok; out.evidence.vin = vinRaws[0] || bv.vin; }
  const de = /descripci[oó]n\s*:?\s*([^\n]{6,90})/i.exec(t);
  if (de) out.description = de[1].trim();
  out.found = ['insurer', 'policyNumber', 'validFrom', 'year', 'vin'].filter((k) => out[k]);
  return out;
}
