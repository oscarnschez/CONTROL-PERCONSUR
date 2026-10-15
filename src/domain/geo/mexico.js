/*
 * Geografía de México para el Mapa de viajes (reglas puras: sin almacenamiento ni DOM).
 *
 * STATES      las 32 entidades federativas con su clave oficial del INEGI (CVE_ENT 01–32), su clave ISO 3166-2 (la que
 *             trae la geometría de assets/geo/mx-estados.json) y sus nombres, alias y abreviaturas.
 * resolveText(texto) → { status:'state'|'foreign'|'ambiguous'|'unknown', code?, candidates?, how, note }
 *             identifica la entidad de un texto de destino («Guadalajara, Jal.», «Zapopan Jalisco», «GDL», «Jalisco»).
 *             Reglas, en orden:
 *               1. Entidad escrita: nombre completo o alias únicos en cualquier parte («jalisco», «nuevo leon», «cdmx»,
 *                  «edomex»); abreviaturas oficiales («Jal.», «NL», «Q. Roo») y nombres de entidad que también son
 *                  municipios de otras entidades (Hidalgo, Morelos, Guerrero, Tabasco) solo como parte separada por coma
 *                  («Pachuca, Hidalgo»), nunca dentro de un nombre de localidad («Dolores Hidalgo», «Puerto Morelos»).
 *                  Dos entidades distintas escritas → ambiguo.
 *               2. Extranjero: «Texas», «Laredo, TX», «Estados Unidos», «Guatemala»… (sin entidad mexicana escrita).
 *               3. Localidad: nomenclátor de municipios y ciudades cuya entidad es única. Los nombres que existen en varias
 *                  entidades (La Paz, Guadalupe, Juárez, Lázaro Cárdenas, Tuxpan…) quedan como ambiguos con sus
 *                  posibles entidades: nunca se asigna una al azar.
 * Proyección: project(lat, lng, proj) usa la cónica conforme de Lambert del INEGI (EPSG:6372, elipsoide GRS80), la misma
 * con que se generó la geometría; stateAt(x, y, shapes) dice en qué entidad cae un punto (geocódigos ya guardados).
 */

/* [clave INEGI, ISO 3166-2, nombre, nombre corto, alias únicos (texto sin acentos), abreviaturas (solo como parte aparte)] */
const RAW = [
  ['01', 'MX-AGU', 'Aguascalientes', 'Aguascalientes', ['aguascalientes'], ['ags']],
  ['02', 'MX-BCN', 'Baja California', 'Baja California', ['baja california', 'baja california norte'], ['bc', 'bcn']],
  ['03', 'MX-BCS', 'Baja California Sur', 'Baja California Sur', ['baja california sur'], ['bcs']],
  ['04', 'MX-CAM', 'Campeche', 'Campeche', ['campeche'], ['camp']],
  ['05', 'MX-COA', 'Coahuila de Zaragoza', 'Coahuila', ['coahuila', 'coahuila de zaragoza'], ['coah']],
  ['06', 'MX-COL', 'Colima', 'Colima', ['colima'], ['col']],
  ['07', 'MX-CHP', 'Chiapas', 'Chiapas', ['chiapas'], ['chis']],
  ['08', 'MX-CHH', 'Chihuahua', 'Chihuahua', ['chihuahua'], ['chih']],
  ['09', 'MX-DIF', 'Ciudad de México', 'Ciudad de México', ['ciudad de mexico', 'cd de mexico', 'cd mexico', 'cdmx', 'distrito federal', 'mexico df'], ['df']],
  ['10', 'MX-DUR', 'Durango', 'Durango', ['durango'], ['dgo']],
  ['11', 'MX-GUA', 'Guanajuato', 'Guanajuato', ['guanajuato'], ['gto']],
  ['12', 'MX-GRO', 'Guerrero', 'Guerrero', ['estado de guerrero', 'edo de guerrero'], ['gro', 'guerrero']],
  ['13', 'MX-HID', 'Hidalgo', 'Hidalgo', ['estado de hidalgo', 'edo de hidalgo'], ['hgo', 'hidalgo']],
  ['14', 'MX-JAL', 'Jalisco', 'Jalisco', ['jalisco'], ['jal']],
  ['15', 'MX-MEX', 'México', 'Estado de México', ['estado de mexico', 'edo de mexico', 'edo mexico', 'edo de mex', 'edo mex', 'edomex'], ['mex']],
  ['16', 'MX-MIC', 'Michoacán de Ocampo', 'Michoacán', ['michoacan', 'michoacan de ocampo'], ['mich']],
  ['17', 'MX-MOR', 'Morelos', 'Morelos', ['estado de morelos', 'edo de morelos'], ['mor', 'morelos']],
  ['18', 'MX-NAY', 'Nayarit', 'Nayarit', ['nayarit'], ['nay']],
  ['19', 'MX-NLE', 'Nuevo León', 'Nuevo León', ['nuevo leon'], ['nl', 'n l']],
  ['20', 'MX-OAX', 'Oaxaca', 'Oaxaca', ['oaxaca'], ['oax']],
  ['21', 'MX-PUE', 'Puebla', 'Puebla', ['puebla'], ['pue', 'pueb']],
  ['22', 'MX-QUE', 'Querétaro', 'Querétaro', ['queretaro', 'queretaro de arteaga'], ['qro']],
  ['23', 'MX-ROO', 'Quintana Roo', 'Quintana Roo', ['quintana roo', 'q roo', 'qroo'], ['qr']],
  ['24', 'MX-SLP', 'San Luis Potosí', 'San Luis Potosí', ['san luis potosi'], ['slp']],
  ['25', 'MX-SIN', 'Sinaloa', 'Sinaloa', ['sinaloa'], ['sin']],
  ['26', 'MX-SON', 'Sonora', 'Sonora', ['sonora'], ['son']],
  ['27', 'MX-TAB', 'Tabasco', 'Tabasco', ['estado de tabasco', 'edo de tabasco'], ['tab', 'tabasco']],
  ['28', 'MX-TAM', 'Tamaulipas', 'Tamaulipas', ['tamaulipas'], ['tamps', 'tamp']],
  ['29', 'MX-TLA', 'Tlaxcala', 'Tlaxcala', ['tlaxcala'], ['tlax']],
  ['30', 'MX-VER', 'Veracruz de Ignacio de la Llave', 'Veracruz', ['veracruz', 'veracruz de ignacio de la llave'], ['ver']],
  ['31', 'MX-YUC', 'Yucatán', 'Yucatán', ['yucatan'], ['yuc']],
  ['32', 'MX-ZAC', 'Zacatecas', 'Zacatecas', ['zacatecas'], ['zac']],
];
export const STATES = RAW.map(([code, iso, name, short, aliases, abbr]) => ({ code, iso, name, short, aliases, abbr }));
export const stateByCode = (code) => STATES.find((s) => s.code === code) || null;
export const stateByIso = (iso) => STATES.find((s) => s.iso === iso) || null;
export const isStateCode = (c) => !!stateByCode(c);
/* Clave de destinos fuera de México (no se cuentan en ninguna entidad) */
export const FOREIGN = 'EXT';

/*
 * Nomenclátor: municipios y ciudades cuyo nombre corresponde a una sola entidad (los más frecuentes en transporte de
 * carga). Un nombre que existe en varias entidades va en AMBIGUOUS, nunca aquí.
 */
const GAZ = {
  '01': 'jesus maria|calvillo|rincon de romos|pabellon de arteaga|san francisco de los romo',
  '02': 'tijuana|mexicali|ensenada|tecate|rosarito|playas de rosarito|san quintin',
  '03': 'los cabos|cabo san lucas|san jose del cabo|ciudad constitucion|comondu|mulege|guerrero negro',
  '04': 'ciudad del carmen|cd del carmen|champoton|escarcega|calkini',
  '05': 'saltillo|torreon|monclova|piedras negras|ramos arizpe|ciudad acuna|cd acuna|sabinas|parras|parras de la fuente|derramadero|nueva rosita|muzquiz|castanos|san pedro de las colonias',
  '06': 'manzanillo|tecoman|villa de alvarez|armeria|comala',
  '07': 'tuxtla gutierrez|tapachula|san cristobal de las casas|comitan|palenque|puerto chiapas|puerto madero|chiapa de corzo',
  '08': 'ciudad juarez|cd juarez|delicias|hidalgo del parral|parral|nuevo casas grandes|ojinaga|ciudad cuauhtemoc',
  '09': 'iztapalapa|azcapotzalco|coyoacan|tlalpan|xochimilco|gustavo a madero|iztacalco|tlahuac|milpa alta|cuajimalpa|magdalena contreras',
  '10': 'gomez palacio|lerdo|ciudad lerdo|santiago papasquiaro|canatlan',
  '11': 'leon|irapuato|celaya|salamanca|silao|san miguel de allende|dolores hidalgo|acambaro|valle de santiago|penjamo|san francisco del rincon|purisima del rincon|apaseo el grande|apaseo el alto|cortazar|salvatierra|uriangato|moroleon|san jose iturbide|romita|juventino rosas|comonfort|yuriria',
  '12': 'acapulco|chilpancingo|iguala|zihuatanejo|taxco|ixtapa',
  '13': 'pachuca|tulancingo|tula de allende|tizayuca|tepeji del rio|ixmiquilpan|apan|huejutla|atitalaquia|tepeapulco|ciudad sahagun',
  '14': 'guadalajara|gdl|zapopan|tlaquepaque|san pedro tlaquepaque|tlajomulco|tlajomulco de zuniga|el salto|puerto vallarta|lagos de moreno|tepatitlan|ocotlan|ciudad guzman|zapotlan el grande|autlan|arandas|la barca|atotonilco el alto|tequila|ameca|jocotepec|chapala|ixtlahuacan de los membrillos|poncitlan|zapotlanejo|encarnacion de diaz|san juan de los lagos|teocaltiche|sayula|acatlan de juarez|nextipac|tala|colotlan|ojuelos|yahualica|cihuatlan|tomatlan|mascota',
  '15': 'toluca|ecatepec|naucalpan|tlalnepantla|nezahualcoyotl|cuautitlan izcalli|cuautitlan|tultitlan|texcoco|chalco|ixtapaluca|nicolas romero|huehuetoca|tepotzotlan|zumpango|lerma|metepec|atizapan|atizapan de zaragoza|coacalco|tecamac|ixtlahuaca|atlacomulco|tultepec|valle de bravo|chicoloapan|huixquilucan|zinacantepec|ocoyoacac|teoloyucan|san mateo atenco|tianguistenco|almoloya de juarez',
  '16': 'morelia|uruapan|zamora|apatzingan|zitacuaro|la piedad|sahuayo|patzcuaro|jiquilpan|maravatio|tangancicuaro|jacona|yurecuaro|puruandiro|tacambaro|huetamo',
  '17': 'cuernavaca|cuautla|jiutepec|temixco|yautepec|jojutla|xochitepec',
  '18': 'tepic|bahia de banderas|nuevo vallarta|compostela|santiago ixcuintla|ixtlan del rio|acaponeta|tecuala|xalisco',
  '19': 'monterrey|mty|san nicolas de los garza|apodaca|san pedro garza garcia|escobedo|general escobedo|cadereyta jimenez|linares|montemorelos|salinas victoria|pesqueria|cienega de flores|sabinas hidalgo',
  '20': 'salina cruz|juchitan|tuxtepec|puerto escondido|huatulco|santa cruz huatulco|matias romero|tehuantepec|huajuapan|pinotepa nacional',
  '21': 'tehuacan|san martin texmelucan|atlixco|cholula|san andres cholula|san pedro cholula|huauchinango|teziutlan|izucar de matamoros|cuautlancingo|amozoc|ciudad serdan|zacatlan|acatzingo|tecamachalco',
  '22': 'santiago de queretaro|san juan del rio|el marques|corregidora|pedro escobedo|tequisquiapan|ezequiel montes|amealco|cadereyta de montes',
  '23': 'cancun|chetumal|playa del carmen|cozumel|tulum|felipe carrillo puerto|bacalar|puerto morelos',
  '24': 'ciudad valles|matehuala|rioverde|soledad de graciano sanchez|tamazunchale|villa de reyes|ciudad fernandez',
  '25': 'culiacan|mazatlan|los mochis|ahome|guasave|guamuchil|navolato|el fuerte|escuinapa|topolobampo|eldorado',
  '26': 'hermosillo|ciudad obregon|cd obregon|guaymas|navojoa|san luis rio colorado|agua prieta|caborca|empalme|puerto penasco|cananea|huatabampo|etchojoa',
  '27': 'villahermosa|comalcalco|macuspana|huimanguillo|cunduacan|tenosique|dos bocas',
  '28': 'reynosa|nuevo laredo|tampico|ciudad madero|altamira|ciudad victoria|cd victoria|rio bravo|el mante|ciudad mante|valle hermoso',
  '29': 'apizaco|huamantla|calpulalpan|chiautempan|zacatelco|tlaxco',
  '30': 'xalapa|coatzacoalcos|poza rica|cordoba|orizaba|minatitlan|boca del rio|papantla|martinez de la torre|san andres tuxtla|cosoleacaque|tierra blanca|acayucan|tantoyuca|alvarado|panuco|perote|cosamaloapan|fortin|rio blanco|tihuatlan|cerro azul|misantla|tlapacoyan',
  '31': 'merida|valladolid|tizimin|uman|kanasin|motul|ticul|tekax|hunucma',
  '32': 'fresnillo|jerez|rio grande|sombrerete|calera|ojocaliente|valparaiso|tlaltenango|concepcion del oro',
};
/* Nombres que existen en varias entidades (o en México y fuera): se piden aclarar, nunca se adivinan */
export const AMBIGUOUS = {
  'la paz': ['03', '15'], loreto: ['03', '32'], guadalupe: ['19', '32'], juarez: ['08', '19'], 'ciudad hidalgo': ['07', '16'],
  cuauhtemoc: ['06', '08', '09'], matamoros: ['05', '28'], 'san pedro': ['05', '19'], 'santa catarina': ['11', '19', '24'],
  tonala: ['07', '14'], villagran: ['11', '28'], 'lazaro cardenas': ['16', '23'], arteaga: ['05', '16'], 'emiliano zapata': ['17', '27', '30'],
  tuxpan: ['14', '16', '18', '30'], 'san blas': ['18', '25'], nogales: ['26', '30', FOREIGN], cardenas: ['24', '27'], jalapa: ['27', '30'],
  progreso: ['05', '31'], cadereyta: ['19', '22'], 'benito juarez': ['09', '23'], laredo: ['28', FOREIGN], allende: ['05', '08', '11', '19'],
  victoria: ['11', '28'], frontera: ['05', '27'], jimenez: ['05', '08', '28'], camargo: ['08', '28'], abasolo: ['05', '11', '28'],
  hidalgo: ['13', '08', '16', '19', '28'], morelos: ['17', '05', '08', '15', '16', '32'], guerrero: ['12', '05', '08', '28'], tabasco: ['27', '32'],
  mexico: ['09', '15', FOREIGN], tula: ['13', '28'], 'santa rosalia': ['03', '08'],
};
/* Registro de entidad asignada a mano (store destStates) con la forma esperada, o null */
export function sanitizeDestState(r) {
  if (!r || typeof r !== 'object') return null;
  const key = foldGeo(r.key), code = String(r.code || '');
  if (!key || key !== r.key || !(isStateCode(code) || code === FOREIGN)) return null;
  return { key, text: String(r.text || '').slice(0, 300), code, by: String(r.by || '').slice(0, 80), at: Number(r.at) || 0 };
}
/* Fuera de México (sin entidad mexicana escrita en el mismo texto) */
const FOREIGN_WORDS = ['usa', 'eua', 'ee uu', 'eeuu', 'estados unidos', 'united states', 'texas', 'tx', 'arizona', 'new mexico',
  'guatemala', 'belice', 'belize', 'canada', 'honduras', 'el salvador', 'houston', 'dallas'];

/* ===== Texto ===== */
/* Minúsculas, sin acentos ni signos; «Méx.» → «mex», «Q. Roo» → «q roo» */
export const foldGeo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
/*
 * Partes separadas por coma, punto y coma, diagonal, paréntesis, salto de línea o guion con espacios. En una dirección
 * completa se quitan el código postal, el país al final («…, México») y las partes de calle (con número o que empiezan
 * con calle, av., col., carretera…): «Av. Sonora 12» o «Calle Durango» no son la entidad de destino.
 */
const STREET = /^(calle|c|av|ave|avenida|blvd|bulevar|boulevard|carretera|carr|km|kilometro|col|colonia|fracc|fraccionamiento|privada|priv|calz|calzada|camino|lote|manzana|mz|lt|no|num|numero|int|interior|esq|esquina|entre|parque industrial|zona industrial|cp|c p|codigo postal)( |$)/;
function segmentsOf(text) {
  let segs = String(text || '').split(/[,;/()\n|]+|\s[-–]\s/).map((t) => foldGeo(t).replace(/\b(c p|cp|codigo postal)\s*\d{5}\b/g, '').replace(/\b\d{5}\b/g, '').trim()).filter(Boolean);
  if (segs.length > 1 && /^(mexico|mx|rep mexicana|republica mexicana)$/.test(segs[segs.length - 1])) segs = segs.slice(0, -1);
  return segs.length > 1 ? segs.filter((t, i) => i === segs.length - 1 || !(/\d/.test(t) || STREET.test(t))) : segs;
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (phrase) => new RegExp(`(^| )${escRe(phrase)}(?= |$)`, 'g');

/* Índices de búsqueda (frases más largas primero para no confundir «baja california» con «baja california sur») */
const STRONG = STATES.flatMap((s) => s.aliases.map((a) => [a, s.code])).sort((a, b) => b[0].length - a[0].length);
const ABBR = new Map(STATES.flatMap((s) => s.abbr.map((a) => [a, s.code])));
const PLACES = [
  ...Object.entries(GAZ).flatMap(([code, list]) => list.split('|').map((p) => [p, [code]])),
  ...Object.entries(AMBIGUOUS).map(([p, codes]) => [p, codes]),
].sort((a, b) => b[0].length - a[0].length);
/* Ciudades que comparten nombre con su propia entidad: también cuentan como localidad */
['aguascalientes', 'campeche', 'colima', 'chihuahua', 'durango', 'guanajuato', 'oaxaca', 'puebla', 'queretaro', 'san luis potosi', 'tlaxcala', 'veracruz', 'zacatecas']
  .forEach((n) => { const c = STRONG.find(([a]) => a === n); if (c) PLACES.push([n, [c[1]]]); });

/* Busca frases enteras sin solaparse (la más larga gana). Las expresiones se compilan una sola vez por frase. */
const RE_CACHE = new Map();
const reOf = (phrase) => { let r = RE_CACHE.get(phrase); if (!r) RE_CACHE.set(phrase, (r = wordRe(phrase))); r.lastIndex = 0; return r; };
function findPhrases(seg, list) {
  const taken = [], out = [];
  for (const [phrase, val] of list) {
    if (phrase.length > seg.length || !seg.includes(phrase)) continue;
    const re = reOf(phrase);
    let m;
    while ((m = re.exec(seg))) {
      const start = m.index + m[1].length, end = start + phrase.length;
      if (!taken.some(([a, b]) => start < b && end > a)) { taken.push([start, end]); out.push({ phrase, val, start, end }); }
    }
  }
  return out;
}

/* Entidades escritas en el texto (paso 1) */
function writtenStates(segs) {
  const codes = new Set();
  segs.forEach((seg, i) => {
    /* Nombres y alias únicos, salvo dentro de una localidad conocida que los contiene (p. ej. «san luis potosi» ya es ambas) */
    findPhrases(seg, STRONG).forEach((m) => codes.add(m.val));
    /* Abreviaturas y nombres de entidad que también son municipios: solo como parte completa después de una coma */
    if (i > 0 && ABBR.has(seg)) codes.add(ABBR.get(seg));
    if (i > 0) { const m = /^(.+) (ags|bc|bcs|camp|coah|col|chis|chih|cdmx|dgo|gto|gro|hgo|jal|mich|mor|nay|nl|oax|pue|qro|q roo|slp|sin|son|tab|tamps|tlax|ver|yuc|zac)$/.exec(seg); if (m && !findPhrases(seg, PLACES).some((p) => p.end > m[1].length)) codes.add(ABBR.get(m[2])); }
  });
  /* «Zapopan Jal» o «Toluca Mex» en una sola parte: abreviatura al final, después de una localidad conocida */
  if (segs.length === 1) {
    const m = /^(.+) (ags|bcs|camp|coah|chis|chih|dgo|gto|hgo|jal|mex|mich|nay|oax|pue|qro|slp|tamps|tlax|yuc|zac)$/.exec(segs[0]);
    if (m && findPhrases(m[1], PLACES).length) codes.add(ABBR.get(m[2]));
  }
  return codes;
}

/*
 * Entidad de un texto de destino. how: 'texto' (entidad escrita) | 'localidad' (nomenclátor) | 'extranjero'.
 * note: explicación para la pantalla (p. ej. «“La Paz” existe en Baja California Sur y en Estado de México»).
 */
const MEMO = new Map();
export function resolveText(text) {
  const k = String(text || '');
  let r = MEMO.get(k);
  if (!r) { if (MEMO.size > 5000) MEMO.clear(); MEMO.set(k, (r = resolveUncached(k))); }
  return { ...r, candidates: r.candidates ? r.candidates.slice() : undefined };
}
function resolveUncached(text) {
  const segs = segmentsOf(text);
  if (!segs.length) return { status: 'unknown', how: '', note: 'Sin destino escrito' };
  const all = segs.join(' , ');
  const written = writtenStates(segs);
  if (written.size === 1) return { status: 'state', code: [...written][0], how: 'texto', note: '' };
  if (written.size > 1) return { status: 'ambiguous', candidates: [...written], how: 'texto', note: 'El destino menciona más de una entidad' };
  const plain = all.replace(/baja california( sur)?/g, ' ');
  if (FOREIGN_WORDS.some((w) => plain.includes(w) && reOf(w).test(plain)) || /(^| )california( |$)/.test(plain)) return { status: 'foreign', code: FOREIGN, how: 'extranjero', note: '' };
  const hits = segs.flatMap((seg) => findPhrases(seg, PLACES));
  if (!hits.length) return { status: 'unknown', how: '', note: 'No se reconoce la entidad del destino' };
  const sure = new Set(hits.filter((h) => h.val.length === 1).map((h) => h.val[0]));
  const doubt = hits.filter((h) => h.val.length > 1);
  if (sure.size === 1) {
    const c = [...sure][0];
    /* Un nombre ambiguo junto a una localidad segura de otra entidad («Guadalupe … Zacatecas») no cambia la regla */
    if (doubt.every((d) => d.val.includes(c))) return { status: 'state', code: c, how: 'localidad', note: '' };
  }
  const cands = [...new Set([...sure, ...doubt.flatMap((d) => d.val)])];
  const named = doubt[0] ? `«${titleOf(doubt[0].phrase)}» existe en ${listNames(doubt[0].val)}` : 'El destino menciona localidades de varias entidades';
  return { status: 'ambiguous', candidates: cands, how: 'localidad', note: named };
}
const ACCENTED = { mexico: 'México', 'lazaro cardenas': 'Lázaro Cárdenas', juarez: 'Juárez', 'benito juarez': 'Benito Juárez', cuauhtemoc: 'Cuauhtémoc',
  tonala: 'Tonalá', villagran: 'Villagrán', cardenas: 'Cárdenas', jimenez: 'Jiménez', 'santa rosalia': 'Santa Rosalía', colon: 'Colón' };
const titleOf = (s) => ACCENTED[s] || s.replace(/(^| )([a-z])/g, (m, a, b) => a + b.toUpperCase());
export const placeName = (code) => (code === FOREIGN ? 'fuera de México' : (stateByCode(code) || {}).short || code);
function listNames(codes) {
  const n = codes.map(placeName);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0] || '';
}

/* ===== Proyección y geometría ===== */
/* Cónica conforme de Lambert del INEGI (EPSG:6372): φ1 17.5°, φ2 29.5°, φ0 12°, λ0 −102°, x0 2 500 000 m, GRS80 */
const A = 6378137, F = 1 / 298.257222101, E = Math.sqrt(2 * F - F * F), RAD = Math.PI / 180;
const mOf = (p) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const tOf = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const P1 = 17.5 * RAD, P2 = 29.5 * RAD, P0 = 12 * RAD, L0 = -102 * RAD;
const N = (Math.log(mOf(P1)) - Math.log(mOf(P2))) / (Math.log(tOf(P1)) - Math.log(tOf(P2)));
const FF = mOf(P1) / (N * tOf(P1) ** N), RHO0 = A * FF * tOf(P0) ** N;
export function lcc(lat, lng) {
  const rho = A * FF * tOf(lat * RAD) ** N, th = N * (lng * RAD - L0);
  return { x: 2500000 + rho * Math.sin(th), y: RHO0 - rho * Math.cos(th) };
}
/* Coordenadas del dibujo (assets/geo/mx-estados.json: proj = { minx, maxy, s, pad }) */
export function project(lat, lng, proj) {
  const p = lcc(lat, lng);
  return { x: (p.x - proj.minx) * proj.s + proj.pad, y: (proj.maxy - p.y) * proj.s + proj.pad };
}
/* Anillos de un trazo «M x,y L x,y … Z» */
export function ringsOf(d) {
  return String(d || '').split('M').filter(Boolean).map((part) => part.replace(/Z/g, '').split('L').map((pt) => pt.split(',').map(Number)));
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/* Entidad en la que cae un punto del dibujo. shapes: [{ code, rings }] (par-impar: respeta huecos e islas) */
export function stateAt(x, y, shapes) {
  for (const s of shapes) {
    let inside = false;
    for (const r of s.rings) if (inRing(x, y, r)) inside = !inside;
    if (inside) return s.code;
  }
  return null;
}
