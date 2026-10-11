// Logo preparation for branding: resize raster images to fit 512px and keep the data URL under the size limit.

export const LOGO_MAX_PX = 512;
/** Max length of the stored data URL (the server limit). */
export const LOGO_MAX_BYTES = 300 * 1024;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml';

export class LogoError extends Error {}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new LogoError('Could not read the file'));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new LogoError('The file is not a readable image'));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, scale: number, type: string, quality: number): string {
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new LogoError('Your browser cannot resize images');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(type, quality);
}

export interface PreparedLogo {
  dataUrl: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

/**
 * PNG / JPEG: scaled down to fit 512×512 (never up), re-encoded, and shrunk further until the
 * data URL fits in 300 KB. SVG: kept as is (vector), only the size is checked.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  const type = file.type;
  if (type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl.length > LOGO_MAX_BYTES) throw new LogoError('The SVG is larger than 300 KB. Simplify it or export a PNG.');
    return { dataUrl, width: null, height: null, bytes: dataUrl.length };
  }
  if (type !== 'image/png' && type !== 'image/jpeg') throw new LogoError('Use a PNG, JPG or SVG file');
  const img = await loadImage(await readAsDataUrl(file));
  if (!img.naturalWidth || !img.naturalHeight) throw new LogoError('The image is empty');
  let scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  let quality = 0.92;
  for (let i = 0; i < 8; i++) {
    const dataUrl = draw(img, scale, type, quality);
    if (dataUrl.length <= LOGO_MAX_BYTES) {
      return {
        dataUrl,
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
        bytes: dataUrl.length,
      };
    }
    if (type === 'image/jpeg' && quality > 0.6) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new LogoError('Could not make the logo small enough. Try a simpler image.');
}
