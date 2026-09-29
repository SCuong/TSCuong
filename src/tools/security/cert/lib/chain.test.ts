import { describe, expect, it } from 'vitest';
import { analyzeChain, findIssuer, isSelfIssued, type ChainCert } from './chain';

const root: ChainCert = { index: 0, subject: 'CN=Root', issuer: 'CN=Root', ski: 'aa', isCA: true };
const inter: ChainCert = { index: 1, subject: 'CN=Inter', issuer: 'CN=Root', ski: 'bb', aki: 'aa', isCA: true };
const leaf: ChainCert = { index: 2, subject: 'CN=leaf.example', issuer: 'CN=Inter', ski: 'cc', aki: 'bb', isCA: false };

const at = (cert: ChainCert, index: number): ChainCert => ({ ...cert, index });

describe('isSelfIssued', () => {
  it('needs matching names and (when present) matching key ids', () => {
    expect(isSelfIssued(root)).toBe(true);
    expect(isSelfIssued(inter)).toBe(false);
    expect(isSelfIssued({ subject: 'CN=X', issuer: 'CN=X', ski: '1', aki: '2' })).toBe(false);
    expect(isSelfIssued({ subject: 'CN=X', issuer: 'CN=X' })).toBe(true);
  });
});

describe('findIssuer', () => {
  it('matches by name and key identifier', () => {
    const certs = [root, inter, leaf];
    expect(findIssuer(leaf, certs)).toBe(inter);
    expect(findIssuer(inter, certs)).toBe(root);
    expect(findIssuer(root, certs)).toBeNull();
  });

  it('rejects a same-named CA with a different key', () => {
    const renewed: ChainCert = { ...inter, index: 3, ski: 'zz' };
    expect(findIssuer(leaf, [renewed])).toBeNull();
    expect(findIssuer(leaf, [renewed, inter])).toBe(inter);
  });

  it('falls back to names when key identifiers are missing', () => {
    const noIds = { ...leaf, aki: undefined };
    expect(findIssuer(noIds, [root, inter])).toBe(inter);
  });
});

describe('analyzeChain', () => {
  it('orders a correctly pasted chain', () => {
    const a = analyzeChain([at(leaf, 0), at(inter, 1), at(root, 2)]);
    expect(a).toEqual({ order: [0, 1, 2], unrelated: [], endsWithRoot: true, missingIssuer: null, inOrder: true });
  });

  it('reorders a reversed chain and says so', () => {
    const a = analyzeChain([at(root, 0), at(inter, 1), at(leaf, 2)]);
    expect(a.order).toEqual([2, 1, 0]);
    expect(a.inOrder).toBe(false);
  });

  it('reports a missing intermediate', () => {
    const a = analyzeChain([at(leaf, 0), at(root, 1)]);
    expect(a.order).toEqual([0]);
    expect(a.missingIssuer).toBe('CN=Inter');
    expect(a.unrelated).toEqual([1]);
    expect(a.endsWithRoot).toBe(false);
  });

  it('handles a chain without root and unrelated certificates', () => {
    const other: ChainCert = { index: 2, subject: 'CN=other', issuer: 'CN=Elsewhere', isCA: false };
    const a = analyzeChain([at(leaf, 0), at(inter, 1), other]);
    expect(a.order).toEqual([0, 1]);
    expect(a.missingIssuer).toBe('CN=Root');
    expect(a.unrelated).toEqual([2]);
  });

  it('survives cycles and duplicates', () => {
    const a: ChainCert = { index: 0, subject: 'CN=A', issuer: 'CN=B', isCA: true };
    const b: ChainCert = { index: 1, subject: 'CN=B', issuer: 'CN=A', isCA: true };
    const result = analyzeChain([a, b]);
    expect(result.order).toHaveLength(2);
    const dup = analyzeChain([at(leaf, 0), at(leaf, 1), at(inter, 2)]);
    expect(dup.order[0]).toBe(0);
    expect(dup.unrelated).toEqual([1]);
    expect(analyzeChain([])).toMatchObject({ order: [], inOrder: true });
  });

  it('treats a single self-signed certificate as a complete chain', () => {
    expect(analyzeChain([root])).toMatchObject({ order: [0], endsWithRoot: true, missingIssuer: null });
  });
});
