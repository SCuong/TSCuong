import type { RequestMap, RequestType } from '../lib/protocol';

export type SqlCall = <K extends RequestType>(
  type: K,
  payload: RequestMap[K]['req'],
  options?: { onProgress?: (label: string) => void; transfer?: Transferable[] },
) => Promise<RequestMap[K]['res']>;
