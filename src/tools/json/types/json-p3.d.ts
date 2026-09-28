// json-p3 ships without its declaration files; this covers the subset LocalKit uses.
declare module 'json-p3' {
  export interface JsonP3Token {
    readonly input: string;
    readonly index: number;
    readonly value: string;
  }
  export class JSONPathError extends Error {
    readonly token: JsonP3Token;
  }
  export class JSONPathSyntaxError extends JSONPathError {}
  export class JSONPathTypeError extends JSONPathError {}
  export class JSONPathIndexError extends JSONPathError {}
  export class JSONPathRecursionLimitError extends JSONPathError {}
  export class JSONPathNode {
    readonly value: unknown;
    readonly location: Array<string | number>;
    getPath(options?: { form?: 'pretty' | 'canonical' }): string;
    toPointer(): { toString(): string };
  }
  export class JSONPathNodeList {
    readonly nodes: JSONPathNode[];
    readonly length: number;
    values(): unknown[];
    paths(options?: { form?: 'pretty' | 'canonical' }): string[];
    [Symbol.iterator](): Iterator<JSONPathNode>;
  }
  export function query(path: string, value: unknown): JSONPathNodeList;
}
