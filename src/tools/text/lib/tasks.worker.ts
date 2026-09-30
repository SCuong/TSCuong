import { runTask } from './tasks';
import type { TaskRequest, TaskResponse } from './taskRunner';

function describe(error: unknown): string {
  // "Invalid string length", "Array buffer allocation failed"…: the result does not fit in memory.
  if (error instanceof RangeError) return 'The text is too large to process in this browser.';
  if (error instanceof Error && error.message) return error.message;
  return 'The calculation failed.';
}

self.onmessage = (event: MessageEvent<TaskRequest>) => {
  const { id, name, args } = event.data;
  let response: TaskResponse;
  try {
    response = { id, ok: true, value: runTask(name, args) };
  } catch (error) {
    response = { id, ok: false, error: describe(error) };
  }
  self.postMessage(response);
};
