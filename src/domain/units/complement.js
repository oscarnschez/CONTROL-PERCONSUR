/*
 * Complemento de pago — detección del PERIODO DE COBERTURA en el texto del documento (puro: recibe texto ya extraído
 * del PDF o por OCR; ver services/docText.js).
 *
 * Formato de referencia (CFDI «Complemento para la recepción de pagos» de BBVA Seguros, captura real del usuario):
 *   Recuadro «PARCIALIDAD n de m» con una tabla de dos filas:
 *     Descripción | Identificación (Póliza) | Inciso | Vigencia | Días que cubre
 *     Pago        | 736A5305PY              | 0      | 1        | 31
 *     Periodo del Recibo (Dia/Mes/Año) | Tipo de Comprobante | Clave de Servicio
 *     11/10/2026 al 11/11/2026         | Pago                | 84111506 …
 *   El periodo es el campo «Periodo del Recibo (Dia/Mes/Año)»: dos fechas DÍA/MES/AÑO unidas por «al».
 *   Se comprueba con «Días que cubre» (11/10 → 11/11 = 31 días).
 * Lo que NO es el periodo y se descarta:
 *   - «Fecha y Hora de Timbrado: 2026-10-14T01:18:51» (fecha de emisión/timbrado del CFDI, formato ISO): se ofrece como
 *     fecha de emisión, nunca como inicio o fin de cobertura.
 *   - «Vigencia: 1» (número de la vigencia de la póliza en la tabla, no es una fecha).
 *   - Fecha de pago, fecha de vencimiento de la factura, «Lugar de Expedición», números de certificado o folio fiscal.
 * Otros formatos: «Periodo/Vigencia/Cobertura … del 01 de octubre de 2026 al 31 de octubre de 2026», «Desde … Hasta …»,
 * «Inicio de vigencia … Fin de vigencia …». Si hay varios periodos distintos sin una etiqueta clara que los distinga,
 * el resultado es «ambiguo» y la pantalla pide elegir; si no hay ninguno, «no encontrado». Nunca se inventa un periodo.
 */
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const p2 = (n) => String(n).padStart(2, '0');
function ymd(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${y}-${p2(m)}-${p2(d)}`;
  const t = new Date(s + 'T00:00:00Z');
  return t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? s : null;
}
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/* Limpia el texto de OCR: «O»/«o» y «l»/«I» pegados a números, espacios dentro de fechas («11 /10/ 2026») */
export function cleanText(t) {
  return String(t || '').replace(/\r/g, '\n')
    /* Solo dentro de lo que parece una fecha (dd/mm/aaaa): O→0, l/I/|→1 y sin espacios */
    .replace(/[0-9OolI|]{1,2}[ \t]*[/.-][ \t]*[0-9OolI|]{1,2}[ \t]*[/.-][ \t]*[0-9OolI|]{2,4}/g, (m) => (/\d/.test(m) ? m.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[ \t]/g, '') : m))
    .replace(/[ \t]+/g, ' ');
}

const LABEL_GOOD = [
  [/periodo del recibo/, 10], [/periodo de cobertura|cobertura del/, 9], [/periodo (de )?(vigencia|pago|cubierto)/, 8], [/vigencia (del|desde)|inicio de vigencia|fin de vigencia/, 7],
  [/periodo/, 5], [/cobertura/, 5], [/vigencia/, 3], [/dias que cubre|dias cubiertos/, 3],
];
const LABEL_BAD = [[/timbrado|certificacion/, -6], [/fecha de pago|fecha pago|pagado el/, -6], [/emision|expedicion|expedido/, -4], [/vencimiento|fecha limite|vence el/, -3]];
const lastAt = (re, s) => { let i = -1; const g = new RegExp(re.source, 'g'); let m; while ((m = g.exec(s))) i = m.index; return i; };
/* Puntaje por la etiqueta más cercana antes de las fechas: una etiqueta de pago, emisión o timbrado solo resta si está
   después (más cerca) que la etiqueta de periodo o vigencia */
function labelScore(before) {
  const b = fold(before);
  let best = 0, goodAt = -1, bad = 0;
  for (const [re, s] of LABEL_GOOD) { const i = lastAt(re, b); if (i >= 0 && s > best) { best = s; goodAt = Math.max(goodAt, i); } else if (i > goodAt && i >= 0 && s >= best - 2) goodAt = i; }
  for (const [re, s] of LABEL_BAD) { const i = lastAt(re, b); if (i > goodAt) bad = Math.min(bad, s); }
  return best + bad;
}

/* Todos los rangos de fechas del texto: { from, to, raw, at, score, label } */
export function findRanges(text) {
  const t = cleanText(text), out = [];
  const D = String.raw`(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})`;
  const SEP = String.raw`\s*(?:al|a|hasta|-|–|—)\s*`;
  const reNum = new RegExp(D + SEP + D, 'gi');
  let m;
  while ((m = reNum.exec(t))) {
    /* DÍA/MES/AÑO (México); si el primer número no puede ser día pero el segundo sí, se descarta: no se adivina el orden */
    const from = ymd(m[3], m[2], m[1]), to = ymd(m[6], m[5], m[4]);
    if (from && to) out.push({ from, to, raw: m[0].trim(), at: m.index });
  }
  const W = String.raw`(\d{1,2})\s+de\s+([a-zA-Záéíóú]+)\.?\s+(?:de|del)?\s*(\d{4})`;
  const reTxt = new RegExp(String.raw`(?:del\s+)?` + W + String.raw`\s*(?:al|hasta|a)\s*` + W, 'gi');
  while ((m = reTxt.exec(t))) {
    const m1 = MESES[fold(m[2])], m2 = MESES[fold(m[5])];
    const from = m1 && ymd(m[3], m1, m[1]), to = m2 && ymd(m[6], m2, m[4]);
    if (from && to) out.push({ from, to, raw: m[0].trim(), at: m.index });
  }
  /* «Desde 01/10/2026 … Hasta 31/10/2026» o «Inicio de vigencia 01/10/2026 … Fin de vigencia 31/10/2026» */
  const reFT = new RegExp(String.raw`(?:desde|inicio(?: de (?:la )?vigencia)?|vigencia desde)\s*:?\s*` + D + String.raw`[\s\S]{0,80}?(?:hasta|fin(?: de (?:la )?vigencia)?|vence|termino)\s*:?\s*` + D, 'gi');
  while ((m = reFT.exec(t))) {
    const from = ymd(m[3], m[2], m[1]), to = ymd(m[6], m[5], m[4]);
    if (from && to) out.push({ from, to, raw: m[0].replace(/\s+/g, ' ').trim(), at: m.index });
  }
  for (const r of out) {
    const before = t.slice(Math.max(0, r.at - 160), r.at);
    r.label = labelScore(before);
    r.score = r.label;
    r.span = days(r.from, r.to);
    if (r.span <= 0 || r.span > 400) r.score -= 20;   /* un periodo invertido o de más de un año no es la cobertura de un recibo */
  }
  return out.sort((a, b) => b.score - a.score || a.at - b.at);
}

/* «Días que cubre 31» (o «Dias cubiertos: 31») */
export function coveredDays(text) {
  const t = fold(cleanText(text));
  const m = /dias (?:que cubre|cubiertos|de cobertura)\s*:?\s*(?:[a-z ()]*?)\s*(\d{1,3})\b/.exec(t);
  if (m) return +m[1];
  /* Tabla: los encabezados en una línea y los valores en la siguiente; «Días que cubre» es la última columna */
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /dias que cubre\s*$/.test(l));
  if (i >= 0 && lines[i + 1]) { const n = /(\d{1,3})\s*$/.exec(lines[i + 1]); if (n) return +n[1]; }
  return null;
}
/* Otros datos útiles (nunca como periodo): fecha de timbrado, póliza, aseguradora, parcialidad, UUID */
export function extraFields(text) {
  const t = cleanText(text), f = fold(t), out = {};
  const ts = /fecha y hora de timbrado\s*:?\s*(\d{4})-(\d{2})-(\d{2})/i.exec(t) || /timbrado[^\d]{0,30}(\d{4})-(\d{2})-(\d{2})/i.exec(t);
  if (ts) out.issueDate = ymd(ts[1], ts[2], ts[3]);
  const pi = t.search(/identificaci[oó]n\s*\(p[oó]liza\)|n[uú]mero de p[oó]liza|p[oó]liza\s*(?:no\.?|n[uú]m\.?)?\s*:/i);
  if (pi >= 0) { const tok = (t.slice(pi, pi + 160).match(/\b[A-Z0-9]{6,16}\b/gi) || []).find((x) => /\d/.test(x) && /[A-Z]/i.test(x)); if (tok) out.policyNumber = tok.toUpperCase(); }
  const ins = /nombre del emisor\s*:?\s*([^\n,]{4,80})/i.exec(t);
  if (ins) out.insurer = ins[1].replace(/\s+/g, ' ').trim();
  else if (/bbva seguros/.test(f)) out.insurer = 'BBVA Seguros';
  const par = /parcialidad\s*(\d{1,3})\s*de\s*(\d{1,3})/i.exec(t);
  if (par) out.installment = `${par[1]} de ${par[2]}`;
  const uuid = /([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})/i.exec(t);
  if (uuid) out.uuid = uuid[1].toUpperCase();
  return out;
}

/*
 * Resultado para la pantalla de confirmación:
 *   { status:'found'|'ambiguous'|'none', from, to, confidence:'alta'|'media', evidence, check, candidates, extra }
 *   found      un solo periodo con etiqueta clara (o el único del documento); check dice si coincide con «Días que cubre»
 *   ambiguous  varios periodos distintos sin uno claramente mejor → la persona elige o escribe las fechas
 *   none       ningún periodo legible → captura manual
 */
export function detectPeriod(text) {
  const extra = extraFields(text);
  const all = findRanges(text).filter((r) => r.score > -10);
  const uniq = [];
  for (const r of all) if (!uniq.some((u) => u.from === r.from && u.to === r.to)) uniq.push(r);
  const cd = coveredDays(text);
  if (!uniq.length) return { status: 'none', candidates: [], extra, coveredDays: cd };
  const best = uniq[0], second = uniq[1];
  const fits = (r) => cd != null && Math.abs(r.span - cd) <= 1;
  const clear = !second || best.score - second.score >= 3 || (fits(best) && !fits(second));
  const check = cd == null ? '' : fits(best) ? `Coincide con «Días que cubre: ${cd}»` : `No coincide con «Días que cubre: ${cd}» (${best.span} días entre las fechas)`;
  const base = { candidates: uniq.map(({ from, to, raw, span, score }) => ({ from, to, raw, span, score })), extra, coveredDays: cd };
  if (!clear) return { status: 'ambiguous', ...base, check: '' };
  const confidence = best.label >= 8 && (cd == null || fits(best)) ? 'alta' : 'media';
  return { status: 'found', from: best.from, to: best.to, confidence, evidence: best.raw, check, ...base };
}
