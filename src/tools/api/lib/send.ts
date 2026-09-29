import { sendViaCompanion } from './companion';
import { toBodyInit, type PreparedRequest } from './prepare';
import type { ApiResponse } from './response';

export interface SendOptions {
  via: 'browser' | 'companion';
  companionPort: number;
  companionToken: string;
  /** Cancels the request (user pressed Cancel / Esc). */
  signal: AbortSignal;
}

/** Combine the user's cancel signal with the request timeout; the timeout aborts with a TimeoutError. */
export function withTimeout(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  if (!timeoutMs || timeoutMs <= 0) return { signal, dispose: () => {} };
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

/** Rethrow the abort reason (fetch rejects with a generic AbortError even when aborted with a TimeoutError). */
function abortReason(signal: AbortSignal, error: unknown): unknown {
  if (signal.aborted && signal.reason instanceof DOMException) return signal.reason;
  return error;
}

/** Send a prepared request directly from the browser or through the companion. Never fabricates a response. */
export async function sendRequest(req: PreparedRequest, options: SendOptions): Promise<ApiResponse> {
  // The companion enforces the request timeout itself; give it a little extra so its own error message wins.
  const { signal, dispose } = withTimeout(options.signal, options.via === 'companion' && req.timeoutMs > 0 ? req.timeoutMs + 2000 : req.timeoutMs);
  try {
    if (options.via === 'companion') {
      const res = await sendViaCompanion(req, options.companionPort, options.companionToken, signal);
      return { ...res, via: 'companion' };
    }
    const started = performance.now();
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: toBodyInit(req.body),
      signal,
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
    });
    const body = await res.blob();
    const timeMs = performance.now() - started;
    const headers: Array<[string, string]> = [];
    res.headers.forEach((value, name) => headers.push([name, value]));
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      body,
      timeMs,
      url: res.url || req.url,
      redirected: res.redirected,
      via: 'browser',
    };
  } catch (error) {
    throw abortReason(signal, error);
  } finally {
    dispose();
  }
}
