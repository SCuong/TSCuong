/// <reference lib="webworker" />
/**
 * Parses a CSV file off the main thread and posts rows in chunks with
 * progress, so very large files never freeze the UI.
 *
 * The file is decoded with a streaming TextDecoder first (Papa Parse's own
 * file streamer decodes fixed byte slices and can split multi-byte UTF-8
 * characters at slice boundaries), then parsed in chunks.
 */
import Papa from 'papaparse';
import { describePapaError, type ParseIssue } from '../lib/csv';

export interface CsvParseRequest {
  file: File;
  delimiter: string;
  encoding: string;
  maxRows: number;
}

export type CsvParseMessage =
  | { type: 'progress'; progress: number; label: string }
  | { type: 'chunk'; rows: string[][]; progress: number; delimiter: string; linebreak: string }
  | { type: 'done'; issues: ParseIssue[]; truncated: boolean; delimiter: string; linebreak: string }
  | { type: 'error'; message: string };

const post = (msg: CsvParseMessage) => (self as unknown as Worker).postMessage(msg);

async function readText(file: File, encoding: string): Promise<string> {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding || 'utf-8');
  } catch {
    throw new Error(`The text encoding “${encoding}” is not supported by this browser.`);
  }
  const reader = file.stream().getReader();
  const parts: string[] = [];
  let read = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    parts.push(decoder.decode(value, { stream: true }));
    if (read - lastPost > 4 * 1024 * 1024) {
      lastPost = read;
      post({ type: 'progress', progress: (read / file.size) * 0.3, label: 'Reading file…' });
    }
  }
  parts.push(decoder.decode());
  const text = parts.join('');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

self.onmessage = async (event: MessageEvent<CsvParseRequest>) => {
  const { file, delimiter, encoding, maxRows } = event.data;
  let text: string;
  try {
    text = await readText(file, encoding);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the file.';
    post({
      type: 'error',
      message: /memory|allocation|length/i.test(message) ? 'The file is too large to open in this browser (out of memory).' : message,
    });
    return;
  }

  let total = 0;
  let truncated = false;
  const issues: ParseIssue[] = [];
  let meta = { delimiter: delimiter || ',', linebreak: '\n' };
  const length = text.length || 1;

  // Papa Parse streams strings in `chunkSize` slices too, but its typings only
  // declare `chunk` for File/URL input, so the config is typed explicitly.
  const config: Papa.ParseConfig<string[]> & {
    chunkSize: number;
    chunk: (results: Papa.ParseResult<string[]>, parser: Papa.Parser) => void;
    error: (error: Error) => void;
  } = {
    delimiter,
    header: false,
    skipEmptyLines: 'greedy',
    chunkSize: 4 * 1024 * 1024,
    chunk(results, parser) {
      let rows = results.data;
      meta = { delimiter: results.meta.delimiter || meta.delimiter, linebreak: results.meta.linebreak || meta.linebreak };
      for (const e of results.errors) {
        if (issues.length >= 50) break;
        const issue = describePapaError(e, total);
        if (issue) issues.push(issue);
      }
      if (total + rows.length > maxRows) {
        rows = rows.slice(0, maxRows - total);
        truncated = true;
      }
      total += rows.length;
      const progress = 0.3 + 0.7 * Math.min(1, (results.meta.cursor ?? 0) / length);
      post({ type: 'chunk', rows, progress, ...meta });
      if (truncated) parser.abort();
    },
    complete() {
      post({ type: 'done', issues, truncated, ...meta });
    },
    error(error) {
      post({ type: 'error', message: error.message || 'Could not parse the file.' });
    },
  };
  Papa.parse<string[]>(text, config);
};
