// Generated images and a tiny ZIP writer for the mock backend: specimen document cards and selfies as SVG,
// so documents, scans and review cases have something to show without shipping real photos.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SKIN = ['#f1c7a5', '#d9a07a', '#b97a56', '#8d5a3b', '#e8b996', '#c68b63'];
const HAIR = ['#2b1d16', '#4a3020', '#1b1b1b', '#6b4a2e', '#3a2a22'];
const SHIRT = ['#2f4858', '#5b3e7a', '#1f6f5c', '#7a3e3e', '#3e5a7a', '#555555'];

/** Small stable hash, so the same person always gets the same face colours. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function face(seed: string, x: number, y: number, w: number, h: number): string {
  const n = hash(seed);
  const skin = SKIN[n % SKIN.length];
  const hair = HAIR[(n >> 3) % HAIR.length];
  const shirt = SHIRT[(n >> 6) % SHIRT.length];
  const cx = x + w / 2;
  const headR = w * 0.24;
  const headY = y + h * 0.38;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#cfd8dc"/>
<path d="M${x + w * 0.08} ${y + h} Q${cx} ${y + h * 0.52} ${x + w * 0.92} ${y + h} Z" fill="${shirt}"/>
<rect x="${cx - w * 0.08}" y="${headY + headR * 0.7}" width="${w * 0.16}" height="${h * 0.14}" fill="${skin}"/>
<ellipse cx="${cx}" cy="${headY}" rx="${headR}" ry="${headR * 1.18}" fill="${skin}"/>
<path d="M${cx - headR} ${headY - headR * 0.2} Q${cx} ${headY - headR * 1.7} ${cx + headR} ${headY - headR * 0.2} Q${cx} ${headY - headR * 0.9} ${cx - headR} ${headY - headR * 0.2} Z" fill="${hair}"/>
<circle cx="${cx - headR * 0.38}" cy="${headY}" r="${headR * 0.08}" fill="#2b2b2b"/>
<circle cx="${cx + headR * 0.38}" cy="${headY}" r="${headR * 0.08}" fill="#2b2b2b"/>
<path d="M${cx - headR * 0.3} ${headY + headR * 0.5} Q${cx} ${headY + headR * 0.7} ${cx + headR * 0.3} ${headY + headR * 0.5}" stroke="#7a4a3a" stroke-width="${Math.max(1.5, w / 80)}" fill="none"/>`;
}

const SPECIMEN = (w: number, h: number) =>
  `<text x="${w / 2}" y="${h / 2}" font-family="Arial, sans-serif" font-size="${Math.round(w / 10)}" font-weight="700" fill="#c0392b" fill-opacity="0.12" text-anchor="middle" transform="rotate(-18 ${w / 2} ${h / 2})">SPECIMEN</text>`;

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

function line(x: number, y: number, label: string, value: string, size = 17): string {
  return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="12" fill="#5b6b73">${esc(label)}</text>
<text x="${x}" y="${y + size + 3}" font-family="Arial, sans-serif" font-size="${size}" font-weight="600" fill="#1d2b33">${esc(value)}</text>`;
}

export interface CardData {
  name: string;
  number: string;
  nationality?: string | null;
  dateOfBirth?: string | null;
  expiryDate?: string | null;
  issueDate?: string | null;
}

/** Emirates ID front (role FRONT). */
export function emiratesIdFront(d: CardData): string {
  const w = 640;
  const h = 404;
  return svg(w, h, `<rect width="${w}" height="${h}" rx="22" fill="#eaf3ef"/>
<rect width="${w}" height="74" rx="22" fill="#0b7a5c"/><rect y="52" width="${w}" height="22" fill="#0b7a5c"/>
<text x="24" y="34" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">UNITED ARAB EMIRATES</text>
<text x="24" y="58" font-family="Arial, sans-serif" font-size="14" fill="#d9f2e8">Resident Identity Card · demo data</text>
${face(d.name, 24, 96, 160, 200)}
${line(206, 110, 'ID Number', d.number, 20)}
${line(206, 162, 'Name', d.name)}
${line(206, 214, 'Nationality', d.nationality ?? '—')}
${line(206, 266, 'Date of Birth', d.dateOfBirth ?? '—')}
${line(420, 266, 'Expiry Date', d.expiryDate ?? '—')}
<rect x="24" y="330" width="592" height="46" rx="8" fill="#d5e8e0"/>
<text x="36" y="360" font-family="Arial, sans-serif" font-size="13" fill="#3d5a50">Issue date ${esc(d.issueDate ?? '—')} · Signature ~~~~~~~~</text>
${SPECIMEN(w, h)}`);
}

/** Emirates ID back (role BACK): card number and the MRZ. */
export function emiratesIdBack(d: CardData & { cardNumber: string; occupation?: string; employer?: string }): string {
  const w = 640;
  const h = 404;
  const id = d.number.replace(/\D/g, '');
  const surname = d.name.split(' ').slice(1).join('<').toUpperCase() || 'X';
  const given = d.name.split(' ')[0].toUpperCase();
  const mrz = [`ILARE${d.cardNumber}${id}`.padEnd(30, '<').slice(0, 30), `${(d.dateOfBirth ?? '000000').replace(/\D/g, '').slice(2, 8)}0M${(d.expiryDate ?? '000000').replace(/\D/g, '').slice(2, 8)}3ARE<<<<<<<<<<<6`.slice(0, 30), `${surname}<<${given}`.padEnd(30, '<').slice(0, 30)];
  return svg(w, h, `<rect width="${w}" height="${h}" rx="22" fill="#eef2f6"/>
${line(24, 40, 'Card Number', d.cardNumber)}
${line(24, 92, 'Occupation', d.occupation ?? '—')}
${line(300, 92, 'Employer', d.employer ?? '—')}
${line(24, 144, 'Issuing Place', 'Dubai')}
<rect x="0" y="250" width="${w}" height="154" fill="#f8f9fa"/>
${mrz.map((l, i) => `<text x="24" y="${290 + i * 38}" font-family="'Courier New', monospace" font-size="26" letter-spacing="2" fill="#1d2b33">${esc(l)}</text>`).join('')}
${SPECIMEN(w, h)}`);
}

/** Passport data page (role FRONT). */
export function passportPage(d: CardData): string {
  const w = 640;
  const h = 450;
  const surname = d.name.split(' ').slice(1).join('<').toUpperCase() || 'X';
  const given = d.name.split(' ')[0].toUpperCase();
  const mrz1 = `P<${(d.nationality ?? 'XXX').slice(0, 3).toUpperCase()}${surname}<<${given}`.padEnd(44, '<').slice(0, 44);
  const mrz2 = `${d.number}<0${(d.nationality ?? 'XXX').slice(0, 3).toUpperCase()}${(d.dateOfBirth ?? '').replace(/\D/g, '').slice(2, 8)}0M${(d.expiryDate ?? '').replace(/\D/g, '').slice(2, 8)}`.padEnd(44, '<').slice(0, 44);
  return svg(w, h, `<rect width="${w}" height="${h}" rx="14" fill="#f4efe4"/>
<text x="24" y="36" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#5a3e1b">PASSPORT · demo data</text>
${face(d.name + 'p', 24, 56, 150, 190)}
${line(196, 70, 'Passport No.', d.number, 20)}
${line(196, 122, 'Surname / Given names', d.name)}
${line(196, 174, 'Nationality', d.nationality ?? '—')}
${line(196, 226, 'Date of birth', d.dateOfBirth ?? '—')}
${line(420, 226, 'Date of expiry', d.expiryDate ?? '—')}
<rect x="0" y="330" width="${w}" height="120" fill="#ebe3d2"/>
<text x="16" y="372" font-family="'Courier New', monospace" font-size="20" letter-spacing="1" fill="#1d2b33">${esc(mrz1)}</text>
<text x="16" y="412" font-family="'Courier New', monospace" font-size="20" letter-spacing="1" fill="#1d2b33">${esc(mrz2)}</text>
${SPECIMEN(w, h)}`);
}

/** Trade licence page (role PAGE). */
export function tradeLicencePage(name: string, number: string): string {
  const w = 480;
  const h = 640;
  return svg(w, h, `<rect width="${w}" height="${h}" fill="#ffffff" stroke="#c9ced6"/>
<rect width="${w}" height="80" fill="#22384f"/>
<text x="24" y="48" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">COMMERCIAL LICENCE</text>
${line(24, 120, 'Licence No.', number, 20)}
${line(24, 180, 'Trade name', name)}
${line(24, 240, 'Legal form', 'Limited Liability Company')}
${line(24, 300, 'Activity', 'General Trading')}
${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="24" y="${370 + i * 34}" width="${400 - i * 37}" height="10" rx="5" fill="#e3e7ec"/>`).join('')}
${SPECIMEN(w, h)}`);
}

/** A selfie (role SELFIE_NORMAL): head and shoulders on a plain background. */
export function selfie(seed: string): string {
  const w = 360;
  const h = 480;
  const bg = ['#dfe7ef', '#ece4da', '#e2ece3', '#e8e2ef'][hash(seed) % 4];
  return svg(w, h, `<rect width="${w}" height="${h}" fill="${bg}"/>${face(seed, 30, 50, 300, 430).replace('fill="#cfd8dc"', `fill="${bg}"`)}
<text x="${w / 2}" y="30" font-family="Arial, sans-serif" font-size="14" fill="#6b7780" text-anchor="middle">selfie · demo data</text>`);
}

// ------------------------------------------------------------------ ZIP (stored, no compression)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of the given files (UTF-8 names, stored without compression). */
export function zip(files: { name: string; data: Uint8Array | string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(new ArrayBuffer(offset + centralSize + 22));
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Names of the files in a ZIP made by zip() (for tests). */
export function zipEntries(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const names: string[] = [];
  let p = 0;
  while (p + 30 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    names.push(dec.decode(bytes.subarray(p + 30, p + 30 + nameLen)));
    p += 30 + nameLen + size;
  }
  return names;
}
