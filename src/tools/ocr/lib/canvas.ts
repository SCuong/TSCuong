/** Decode an image file into a canvas suitable for OCR (EXIF orientation applied, small images upscaled). */
export async function imageFileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be decoded. Use a PNG, JPEG, WebP, GIF or BMP file.');
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  // Tesseract reads small text poorly; upscaling small images improves accuracy.
  const factor = longest < 1000 ? 2 : 1;
  const maxSide = 8000;
  const scale = Math.min(factor, maxSide / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The image is too large to process in this browser.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}
