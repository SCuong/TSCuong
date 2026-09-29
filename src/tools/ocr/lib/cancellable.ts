/** Pure helpers for cancelling OCR work (unit tested without the engine). */

export function cancelledError(): DOMException {
  return new DOMException('The operation was cancelled.', 'AbortError');
}

/**
 * A set of in-flight jobs that can all be rejected at once. tesseract.js leaves pending jobs
 * unsettled forever when its worker is terminated, so every recognition is raced against
 * `cancelAll()`; otherwise a cancelled caller would wait indefinitely.
 */
export class PendingJobs {
  private readonly rejects = new Set<(error: Error) => void>();

  /** Settles like `promise`, or rejects with an AbortError when `cancelAll()` is called first. */
  track<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.rejects.add(reject);
      promise.then(
        (value) => {
          this.rejects.delete(reject);
          resolve(value);
        },
        (error: unknown) => {
          this.rejects.delete(reject);
          reject(error);
        },
      );
    });
  }

  cancelAll(): void {
    for (const reject of this.rejects) reject(cancelledError());
    this.rejects.clear();
  }

  get size(): number {
    return this.rejects.size;
  }
}
