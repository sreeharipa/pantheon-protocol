// Client-side image downscaling so hero art stays light. Uploads are resized to a
// max edge and re-encoded as WebP before going to Cloud Storage. 1024px keeps portraits
// crisp on high-DPI phones (even full-screen) while landing around 150–350 KB each.

const MAX_EDGE = 1024;
const QUALITY = 0.85;

async function drawDownscaled(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for image processing.');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  return canvas;
}

/** Downscaled WebP blob, ready to upload to Cloud Storage. */
export async function fileToDownscaledBlob(file: File): Promise<Blob> {
  const canvas = await drawDownscaled(file);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY),
  );
  if (!blob) throw new Error('Failed to encode image.');
  return blob;
}

/** Downscaled WebP data URL (kept for any inline/offline use). */
export async function fileToDownscaledDataUrl(file: File): Promise<string> {
  const canvas = await drawDownscaled(file);
  return canvas.toDataURL('image/webp', QUALITY);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
