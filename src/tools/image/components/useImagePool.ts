import { useEffect, useState } from 'react';
import { ImagePool } from '../lib/pool';

/** A worker pool scoped to the tool: workers are terminated on unmount. */
export function useImagePool(): ImagePool {
  const [pool] = useState(() => new ImagePool(2));
  useEffect(() => () => pool.dispose(), [pool]);
  return pool;
}
