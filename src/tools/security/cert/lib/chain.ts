/** Orders a set of certificates into chains (leaf → root) from names and key identifiers. */

export interface ChainCert {
  /** Position in the pasted input (0-based). */
  index: number;
  subject: string;
  issuer: string;
  /** Subject key identifier (hex), if present. */
  ski?: string;
  /** Authority key identifier (hex), if present. */
  aki?: string;
  isCA: boolean;
}

export interface ChainAnalysis {
  /** Indices in chain order: leaf first, then each issuer. */
  order: number[];
  /** Certificates that are not connected to the main chain. */
  unrelated: number[];
  /** The last certificate of the chain is self-issued (a root). */
  endsWithRoot: boolean;
  /** Issuer name of the last certificate when its issuer is not included. */
  missingIssuer: string | null;
  /** The pasted order already runs leaf → root. */
  inOrder: boolean;
}

export function isSelfIssued(cert: Pick<ChainCert, 'subject' | 'issuer' | 'ski' | 'aki'>): boolean {
  if (cert.subject !== cert.issuer) return false;
  return !cert.ski || !cert.aki || cert.ski === cert.aki;
}

/** The certificate among `certs` that issued `cert`, or null. */
export function findIssuer(cert: ChainCert, certs: ChainCert[]): ChainCert | null {
  if (isSelfIssued(cert)) return null;
  const byName = certs.filter((c) => c !== cert && c.subject === cert.issuer);
  if (byName.length === 0) return null;
  if (cert.aki) {
    const byKey = byName.find((c) => c.ski === cert.aki);
    if (byKey) return byKey;
    // Same name but a different key: not this certificate's issuer (e.g. a renewed CA).
    const withoutSki = byName.find((c) => !c.ski);
    return withoutSki ?? null;
  }
  return byName[0];
}

export function analyzeChain(certs: ChainCert[]): ChainAnalysis {
  if (certs.length === 0) return { order: [], unrelated: [], endsWithRoot: false, missingIssuer: null, inOrder: true };
  const issuerOf = new Map<ChainCert, ChainCert | null>(certs.map((c) => [c, findIssuer(c, certs)]));
  const issuesSomething = new Set<ChainCert>();
  for (const parent of issuerOf.values()) if (parent) issuesSomething.add(parent);

  // Chain length from each candidate leaf; the longest chain wins, then non-CA leaves, then input order.
  const walk = (start: ChainCert) => {
    const path: ChainCert[] = [];
    const seen = new Set<ChainCert>();
    for (let c: ChainCert | null = start; c && !seen.has(c); c = issuerOf.get(c) ?? null) {
      seen.add(c);
      path.push(c);
    }
    return path;
  };
  const leaves = certs.filter((c) => !issuesSomething.has(c));
  const candidates = (leaves.length ? leaves : certs).map((c) => walk(c));
  candidates.sort((a, b) => b.length - a.length || Number(a[0].isCA) - Number(b[0].isCA) || a[0].index - b[0].index);
  const path = candidates[0];

  const last = path[path.length - 1];
  const endsWithRoot = isSelfIssued(last);
  const order = path.map((c) => c.index);
  const inChain = new Set(order);
  const sortedIndices = [...order].sort((a, b) => a - b);
  return {
    order,
    unrelated: certs.filter((c) => !inChain.has(c.index)).map((c) => c.index),
    endsWithRoot,
    missingIssuer: endsWithRoot ? null : last.issuer,
    inOrder: order.every((idx, i) => idx === sortedIndices[i]),
  };
}
