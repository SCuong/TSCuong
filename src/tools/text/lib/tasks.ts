/**
 * Pure, heavy text computations that may run in a Web Worker (see tasks.worker.ts and
 * useTask). Only the worker imports this registry at runtime; components import the
 * individual functions directly so their chunks stay small. Every task must work without the
 * DOM (no DOMParser), and its arguments and result must be structured-cloneable.
 */
import { textStats } from './stats';
import { charFrequency, wordFrequency } from './frequency';
import { findDuplicateWords } from './duplicates';
import { findAndReplace } from './findReplace';
import { filterLines } from './lines';
import { analyzeNormalization } from './normalize';
import { convertQuotes } from './quotes';
import { reverseText } from './reverse';
import { emailReport } from './extract';
import { makeSlugs } from './slug';
import { encodeEntitiesCounted } from '../../encoding/lib/htmlEntities';
import { convertUnicodeEscapes } from '../../encoding/lib/unicodeEscape';
import { convertString } from '../../encoding/lib/stringEscape';
import { binaryConvert, hexConvert } from '../../encoding/lib/hexBinary';
import { rotate } from '../../encoding/lib/rot';
import { convertDomains } from '../../encoding/lib/punycode';
import { summarize } from '../../encoding/lib/inspect';
import { convertBase64 } from '../../encoding/lib/base64';

const TASKS = {
  textStats,
  wordFrequency,
  charFrequency,
  findDuplicateWords,
  findAndReplace,
  filterLines,
  analyzeNormalization,
  convertQuotes,
  reverseText,
  emailReport,
  makeSlugs,
  encodeEntitiesCounted,
  convertUnicodeEscapes,
  convertString,
  hexConvert,
  binaryConvert,
  rotate,
  convertDomains,
  summarize,
  convertBase64,
};

export type TaskName = keyof typeof TASKS;
export type TaskArgs<N extends TaskName> = Parameters<(typeof TASKS)[N]>;
export type TaskResult<N extends TaskName> = ReturnType<(typeof TASKS)[N]>;

export function runTask(name: TaskName, args: unknown[]): unknown {
  const fn = TASKS[name] as ((...a: unknown[]) => unknown) | undefined;
  if (typeof fn !== 'function') throw new Error(`Unknown task "${String(name)}".`);
  return fn(...args);
}
