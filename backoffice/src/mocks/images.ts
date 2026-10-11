// SVG placeholder images for mock media. Faces are cartoon avatars; documents are marked SPECIMEN.

export interface MediaMeta {
  id: number;
  role: string;
  /** Visual seed: the same person always gets the same face. */
  faceSeed: number;
  name: string;
  docNumber: string | null;
  docType: string | null;
  defect: string | null; // TOO_DARK, BLURRY, ... for failed attempts
  purged: boolean;
  createdAt: string;
}

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d1a17a'];
const HAIR = ['#2c1b0e', '#4a2c17', '#6b4423', '#111111', '#3b3024', '#7a5c3a'];
const BG = ['#dbe7f3', '#e8e2d6', '#dfe9dd', '#ece0e8', '#e2e2ea', '#f0e6d2'];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function face(seed: number, cx: number, cy: number, scale: number, turned: boolean): string {
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed >> 2) % HAIR.length];
  const headwear = seed % 3 === 0; // ghutra/shayla style covering
  const dx = turned ? 14 * scale : 0;
  const s = scale;
  return `
  <g>
    <path d="M${cx - 70 * s} ${cy + 150 * s} q${70 * s} -60 ${140 * s} 0 v${40 * s} h-${140 * s} z" fill="${headwear ? '#f5f5f5' : '#35506b'}"/>
    <rect x="${cx - 18 * s}" y="${cy + 40 * s}" width="${36 * s}" height="${40 * s}" fill="${skin}"/>
    ${headwear
      ? `<ellipse cx="${cx}" cy="${cy - 5 * s}" rx="${66 * s}" ry="${80 * s}" fill="#fafafa" stroke="#ddd"/>`
      : `<ellipse cx="${cx}" cy="${cy - 18 * s}" rx="${54 * s}" ry="${58 * s}" fill="${hair}"/>`}
    <ellipse cx="${cx + dx * 0.3}" cy="${cy}" rx="${46 * s}" ry="${56 * s}" fill="${skin}"/>
    <ellipse cx="${cx - 16 * s + dx}" cy="${cy - 6 * s}" rx="${5 * s}" ry="${4 * s}" fill="#222"/>
    <ellipse cx="${cx + 16 * s + dx}" cy="${cy - 6 * s}" rx="${5 * s}" ry="${4 * s}" fill="#222"/>
    <path d="M${cx - 24 * s + dx} ${cy - 18 * s} q${8 * s} -5 ${16 * s} 0 M${cx + 8 * s + dx} ${cy - 18 * s} q${8 * s} -5 ${16 * s} 0" stroke="${hair}" stroke-width="${3 * s}" fill="none"/>
    <path d="M${cx + dx} ${cy - 2 * s} l-${5 * s} ${18 * s} h${9 * s}" stroke="#00000055" stroke-width="${2 * s}" fill="none"/>
    <path d="M${cx - 14 * s + dx} ${cy + 28 * s} q${14 * s} ${10 * s} ${28 * s} 0" stroke="#7a3b2e" stroke-width="${3 * s}" fill="none"/>
    ${seed % 4 === 1 ? `<path d="M${cx - 30 * s} ${cy + 20 * s} q${30 * s} ${50 * s} ${60 * s} 0" fill="${hair}" opacity="0.85"/>` : ''}
  </g>`;
}

function defectFilter(defect: string | null): { defs: string; attr: string; overlay: string } {
  if (defect === 'TOO_DARK')
    return { defs: '', attr: '', overlay: '<rect width="100%" height="100%" fill="#000" opacity="0.72"/>' };
  if (defect === 'BLURRY')
    return {
      defs: '<filter id="blur"><feGaussianBlur stdDeviation="9"/></filter>',
      attr: 'filter="url(#blur)"',
      overlay: '',
    };
  return { defs: '', attr: '', overlay: '' };
}

function selfie(m: MediaMeta): string {
  const closer = m.role === 'SELFIE_CLOSER';
  const notCloser = m.defect === 'NOT_CLOSER';
  const scale = closer && !notCloser ? 1.45 : 1;
  const seed = m.defect === 'FACE_CHANGED' && closer ? m.faceSeed + 7 : m.faceSeed;
  const f = defectFilter(m.defect);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
  <defs>${f.defs}</defs>
  <g ${f.attr}>
    <rect width="480" height="640" fill="${BG[m.faceSeed % BG.length]}"/>
    <rect y="460" width="480" height="180" fill="#00000010"/>
    ${face(seed, 240, 300, scale * 1.7, m.defect === 'HEAD_TURNED')}
  </g>
  ${f.overlay}
  <text x="16" y="620" font-family="Segoe UI, Arial" font-size="18" fill="#ffffffcc" stroke="#00000055" stroke-width="0.5">${closer ? 'Selfie — closer' : 'Selfie'} · demo image</text>
</svg>`;
}

function portrait(m: MediaMeta): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="380" viewBox="0 0 300 380">
  <defs><filter id="g"><feColorMatrix type="saturate" values="0.35"/></filter></defs>
  <g filter="url(#g)"><rect width="300" height="380" fill="#e9eef2"/>${face(m.faceSeed, 150, 180, 1.15, false)}</g>
  <text x="150" y="365" text-anchor="middle" font-family="Arial" font-size="14" fill="#8a96a3" letter-spacing="3">SPECIMEN</text>
</svg>`;
}

function card(m: MediaMeta): string {
  const passport = m.docType === 'PASSPORT';
  const tl = m.docType === 'TRADE_LICENCE';
  const back = m.role === 'BACK';
  const f = defectFilter(m.defect);
  const title = tl
    ? 'DEPARTMENT OF ECONOMY — TRADE LICENCE'
    : passport
      ? 'PASSPORT · جواز سفر'
      : 'UNITED ARAB EMIRATES · IDENTITY CARD';
  const bg = tl ? '#f7f3e8' : passport ? '#e9eef7' : '#e8f1ec';
  const accent = tl ? '#9a7b2f' : passport ? '#2f4f8a' : '#1f7a4d';
  const w = tl ? 620 : 640;
  const h = tl ? 860 : 404;
  if (tl) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/><rect x="20" y="20" width="${w - 40}" height="${h - 40}" fill="none" stroke="${accent}" stroke-width="3"/>
  <text x="${w / 2}" y="80" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="22" fill="${accent}">${title}</text>
  ${['Licence No: ' + (m.docNumber ?? ''), 'Trade name: ' + m.name, 'Legal form: Limited Liability Company', 'Activity: General Trading', 'Issue date: 2025-03-01'].map((t, i) => `<text x="60" y="${170 + i * 50}" font-family="Arial" font-size="20" fill="#333">${esc(t)}</text>`).join('')}
  ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="60" y="${450 + i * 36}" width="${500 - (i % 3) * 90}" height="12" fill="#00000014"/>`).join('')}
  <text x="${w / 2}" y="${h / 2 + 60}" text-anchor="middle" font-family="Arial" font-size="80" fill="#c0392b22" transform="rotate(-25 ${w / 2} ${h / 2})">SPECIMEN</text>
</svg>`;
  }
  const lines = back
    ? `<rect x="40" y="70" width="380" height="14" fill="#00000018"/><rect x="40" y="100" width="300" height="14" fill="#00000018"/>
       <rect x="40" y="130" width="340" height="14" fill="#00000018"/>
       <text x="40" y="300" font-family="Courier New, monospace" font-size="19" fill="#222">ILARE${(m.docNumber ?? '').replace(/-/g, '')}&lt;&lt;&lt;&lt;</text>
       <text x="40" y="328" font-family="Courier New, monospace" font-size="19" fill="#222">9001011M2911309ARE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;8</text>
       <text x="40" y="356" font-family="Courier New, monospace" font-size="19" fill="#222">${esc(m.name.toUpperCase().replace(/ /g, '&lt;'))}&lt;&lt;</text>`
    : `${face(m.faceSeed, 130, 200, 0.95, false)}
       <text x="250" y="140" font-family="Arial" font-size="15" fill="#666">Name</text>
       <text x="250" y="164" font-family="Arial" font-weight="bold" font-size="20" fill="#222">${esc(m.name)}</text>
       <text x="250" y="204" font-family="Arial" font-size="15" fill="#666">${passport ? 'Passport No' : 'ID Number'}</text>
       <text x="250" y="228" font-family="Arial" font-weight="bold" font-size="20" fill="#222">${esc(m.docNumber ?? '')}</text>
       <text x="250" y="268" font-family="Arial" font-size="15" fill="#666">Nationality</text>
       <text x="250" y="292" font-family="Arial" font-size="18" fill="#222">United Arab Emirates</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${f.defs}</defs>
  <g ${f.attr}>
  <rect width="${w}" height="${h}" rx="22" fill="${bg}"/>
  <rect width="${w}" height="54" rx="22" fill="${accent}"/><rect y="30" width="${w}" height="24" fill="${accent}"/>
  <text x="24" y="36" font-family="Arial" font-weight="bold" font-size="20" fill="#fff">${title}</text>
  ${lines}
  <text x="${w / 2}" y="${h / 2 + 30}" text-anchor="middle" font-family="Arial" font-size="72" fill="#c0392b26" transform="rotate(-18 ${w / 2} ${h / 2})">SPECIMEN</text>
  </g>
  ${f.overlay}
</svg>`;
}

function signature(m: MediaMeta): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="140" viewBox="0 0 400 140"><rect width="400" height="140" fill="#fff"/>
  <path d="M30 100 C 70 ${20 + (m.faceSeed % 30)}, 110 120, 150 70 S 230 30, 260 90 S 330 60, 370 50" stroke="#1d2b6b" stroke-width="3" fill="none"/></svg>`;
}

export function renderMedia(m: MediaMeta): string {
  switch (m.role) {
    case 'SELFIE_NORMAL':
    case 'SELFIE_CLOSER':
      return selfie(m);
    case 'FACE_PHOTO':
      return portrait(m);
    case 'SIGNATURE':
      return signature(m);
    default:
      return card(m);
  }
}
