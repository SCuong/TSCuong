import { standaloneSvg, svgSize } from './diagrams';

/** Largest canvas side most browsers can allocate reliably. */
const MAX_CANVAS_SIDE = 16_384;

/**
 * Rasterizes an SVG string to a PNG blob at `scale`x resolution on a solid
 * background. Loads the SVG from a data: URL so the canvas stays untainted.
 */
export async function svgToPng(svg: string, background: string, scale = 2): Promise<Blob> {
  const size = svgSize(svg);
  if (!size) throw new Error('The diagram has no measurable size.');
  let factor = scale;
  const longest = Math.max(size.width, size.height) * factor;
  if (longest > MAX_CANVAS_SIDE) factor = MAX_CANVAS_SIDE / Math.max(size.width, size.height);
  const width = Math.max(1, Math.round(size.width * factor));
  const height = Math.max(1, Math.round(size.height * factor));

  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The browser could not load the diagram as an image.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standaloneSvg(svg))}`;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be created (image too large?).'))), 'image/png');
    } catch (error) {
      reject(
        error instanceof DOMException && error.name === 'SecurityError'
          ? new Error('The browser blocked PNG export for this diagram. Export as SVG instead.')
          : error,
      );
    }
  });
}
