import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/utils';
import { decodeImage } from '../lib/canvas';
import type { ImageHeader } from '../lib/formats';

export interface LoadedImage {
  file: File;
  bitmap: ImageBitmap;
  url: string;
  width: number;
  height: number;
  header: ImageHeader;
}

/**
 * Loads one image for interactive tools: decoded bitmap + object URL for
 * display. The bitmap is closed and the URL revoked on replace and unmount.
 */
export function useSingleImage() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef<LoadedImage | null>(null);
  const seq = useRef(0);

  const release = (img: LoadedImage | null) => {
    if (!img) return;
    img.bitmap.close();
    URL.revokeObjectURL(img.url);
  };

  const load = useCallback(async (file: File) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const decoded = await decodeImage(file);
      if (id !== seq.current) {
        decoded.bitmap.close();
        return;
      }
      const next: LoadedImage = {
        file,
        bitmap: decoded.bitmap,
        url: URL.createObjectURL(file),
        width: decoded.width,
        height: decoded.height,
        header: decoded.header,
      };
      release(current.current);
      current.current = next;
      setImage(next);
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e, 'This image could not be opened.'));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    seq.current++;
    release(current.current);
    current.current = null;
    setImage(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => () => release(current.current), []);

  return { image, error, loading, load, clear };
}
