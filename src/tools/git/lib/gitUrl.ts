/**
 * Parse Git remote URLs (SSH, scp-like, HTTPS, git://, file://) and hosting
 * web links (GitHub, GitLab, Bitbucket Cloud, Azure DevOps), and generate
 * clone URLs and file links. Pure string logic, no network.
 */

export type Provider = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'generic';
export type UrlForm = 'scp' | 'ssh' | 'https' | 'http' | 'git' | 'file' | 'shorthand';
export type LinkKind =
  | 'repo'
  | 'blob'
  | 'tree'
  | 'raw'
  | 'blame'
  | 'commit'
  | 'history'
  | 'pull'
  | 'issue'
  | 'compare'
  | 'release'
  | 'other';

export interface GitUrlInfo {
  form: UrlForm;
  provider: Provider;
  host: string;
  port: string | null;
  user: string | null;
  /** Owner / namespace. May contain slashes (GitLab subgroups) or be "org/project" for Azure DevOps. */
  owner: string;
  repo: string;
  kind: LinkKind;
  ref: string | null;
  path: string | null;
  commit: string | null;
  /** Pull/merge request or issue number. */
  number: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  /** Azure DevOps organisation and project. */
  azure: { org: string; project: string } | null;
  notes: string[];
}

export type ParseResult = { ok: true; info: GitUrlInfo } | { ok: false; error: string };

export const PROVIDER_NAMES: Record<Provider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  azure: 'Azure DevOps',
  generic: 'Other host',
};

const SCHEME_URL_RE = /^([a-z][a-z0-9+.-]*):\/\/(?:([^@/?#]*)@)?(\[[^\]]+\]|[^/:?#]*)(?::(\d*))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i;
const SCP_RE = /^(?:([^@/\s]+)@)?(\[[^\]]+\]|[^/:\s]+):(?!\/\/)(.*)$/;
const BARE_HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\//i;
const SHA_RE = /^[0-9a-f]{7,64}$/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function detectProvider(host: string): Provider {
  const h = host.toLowerCase();
  if (h === 'github.com' || h === 'www.github.com' || h === 'raw.githubusercontent.com' || h === 'ssh.github.com' || /(^|\.)github\./.test(h)) return 'github';
  if (h === 'gitlab.com' || h === 'www.gitlab.com' || /(^|\.)gitlab\./.test(h)) return 'gitlab';
  if (h === 'bitbucket.org' || h === 'www.bitbucket.org') return 'bitbucket';
  if (h === 'dev.azure.com' || h === 'ssh.dev.azure.com' || h.endsWith('.visualstudio.com')) return 'azure';
  return 'generic';
}

function stripGit(name: string): string {
  return name.replace(/\.git$/i, '');
}

function empty(form: UrlForm, provider: Provider, host: string): GitUrlInfo {
  return {
    form,
    provider,
    host,
    port: null,
    user: null,
    owner: '',
    repo: '',
    kind: 'repo',
    ref: null,
    path: null,
    commit: null,
    number: null,
    lineStart: null,
    lineEnd: null,
    azure: null,
    notes: [],
  };
}

function toNumber(s: string | undefined): number | null {
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

function setLines(info: GitUrlInfo, a: string | undefined, b: string | undefined) {
  info.lineStart = toNumber(a);
  info.lineEnd = toNumber(b);
  if (info.lineStart !== null && info.lineEnd !== null && info.lineEnd < info.lineStart) {
    [info.lineStart, info.lineEnd] = [info.lineEnd, info.lineStart];
  }
  if (info.lineEnd === info.lineStart) info.lineEnd = null;
}

/** Split a ref-then-path tail. Branches with "/" are ambiguous in URLs; we assume the first segment is the ref. */
function refAndPath(info: GitUrlInfo, tail: string[]) {
  if (!tail.length) return;
  info.ref = tail[0];
  const path = tail.slice(1).join('/');
  info.path = path || null;
  if (SHA_RE.test(info.ref) && info.ref.length === 40) info.commit = info.ref;
  if (info.path) {
    info.notes.push('Branch names containing “/” cannot be told apart from the path in a URL; the first segment was taken as the branch.');
  }
}

function parseGitHub(info: GitUrlInfo, segs: string[], fragment: string, rawHost: boolean) {
  if (rawHost) {
    // raw.githubusercontent.com/owner/repo/<ref>/<path> (ref may be refs/heads/<name>)
    if (segs.length < 3) throw new Error('A raw.githubusercontent.com link needs an owner, repository, branch and file path.');
    info.owner = segs[0];
    info.repo = segs[1];
    info.host = 'github.com';
    info.kind = 'raw';
    let tail = segs.slice(2);
    if ((tail[0] === 'refs' && (tail[1] === 'heads' || tail[1] === 'tags')) && tail.length > 2) tail = tail.slice(2);
    refAndPath(info, tail);
    return;
  }
  if (segs.length < 2) throw new Error('This GitHub link does not include both an owner and a repository name.');
  info.owner = segs[0];
  info.repo = stripGit(segs[1]);
  const [section, ...tail] = segs.slice(2);
  switch (section) {
    case undefined:
      break;
    case 'blob':
    case 'tree':
    case 'blame':
    case 'raw':
      info.kind = section;
      refAndPath(info, tail);
      break;
    case 'commit':
      info.kind = 'commit';
      info.commit = tail[0] ?? null;
      break;
    case 'commits':
      info.kind = 'history';
      refAndPath(info, tail);
      break;
    case 'pull':
      info.kind = 'pull';
      info.number = toNumber(tail[0]);
      break;
    case 'issues':
      info.kind = tail[0] ? 'issue' : 'other';
      info.number = toNumber(tail[0]);
      break;
    case 'compare':
      info.kind = 'compare';
      info.ref = tail.join('/') || null;
      break;
    case 'releases':
      info.kind = 'release';
      info.ref = tail[0] === 'tag' ? tail.slice(1).join('/') || null : null;
      break;
    default:
      info.kind = 'other';
  }
  const m = /^L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/.exec(fragment);
  if (m) setLines(info, m[1], m[2]);
}

function parseGitLab(info: GitUrlInfo, segs: string[], fragment: string) {
  const dash = segs.indexOf('-');
  const project = dash >= 0 ? segs.slice(0, dash) : segs;
  if (project.length < 2) throw new Error('This GitLab link does not include both a group and a project name.');
  info.owner = project.slice(0, -1).join('/');
  info.repo = stripGit(project[project.length - 1]);
  if (dash >= 0) {
    const [section, ...tail] = segs.slice(dash + 1);
    switch (section) {
      case 'blob':
      case 'tree':
      case 'blame':
      case 'raw':
        info.kind = section;
        refAndPath(info, tail);
        break;
      case 'commit':
        info.kind = 'commit';
        info.commit = tail[0] ?? null;
        break;
      case 'commits':
        info.kind = 'history';
        refAndPath(info, tail);
        break;
      case 'merge_requests':
        info.kind = 'pull';
        info.number = toNumber(tail[0]);
        break;
      case 'issues':
        info.kind = tail[0] ? 'issue' : 'other';
        info.number = toNumber(tail[0]);
        break;
      case 'compare':
        info.kind = 'compare';
        info.ref = tail.join('/') || null;
        break;
      case 'tags':
        info.kind = 'release';
        info.ref = tail.join('/') || null;
        break;
      default:
        info.kind = 'other';
    }
  }
  const m = /^L(\d+)(?:-L?(\d+))?$/.exec(fragment);
  if (m) setLines(info, m[1], m[2]);
}

function parseBitbucket(info: GitUrlInfo, segs: string[], fragment: string) {
  if (segs.length < 2) throw new Error('This Bitbucket link does not include both a workspace and a repository name.');
  info.owner = segs[0];
  info.repo = stripGit(segs[1]);
  const [section, ...tail] = segs.slice(2);
  switch (section) {
    case undefined:
      break;
    case 'src':
      refAndPath(info, tail);
      info.kind = info.path ? 'blob' : 'tree';
      break;
    case 'raw':
      info.kind = 'raw';
      refAndPath(info, tail);
      break;
    case 'annotate':
      info.kind = 'blame';
      refAndPath(info, tail);
      break;
    case 'commits':
      if (tail[0] && SHA_RE.test(tail[0])) {
        info.kind = 'commit';
        info.commit = tail[0];
      } else info.kind = 'history';
      break;
    case 'pull-requests':
      info.kind = 'pull';
      info.number = toNumber(tail[0]);
      break;
    case 'issues':
      info.kind = tail[0] ? 'issue' : 'other';
      info.number = toNumber(tail[0]);
      break;
    default:
      info.kind = 'other';
  }
  const m = /^lines-(\d+)(?::(\d+))?$/.exec(fragment);
  if (m) setLines(info, m[1], m[2]);
}

function parseAzure(info: GitUrlInfo, host: string, segs: string[], query: URLSearchParams) {
  const h = host.toLowerCase();
  let org: string;
  let rest: string[];
  if (h === 'ssh.dev.azure.com' || h === 'vs-ssh.visualstudio.com') {
    // v3/org/project/repo
    if (segs[0] !== 'v3' || segs.length < 4) throw new Error('Azure DevOps SSH URLs look like git@ssh.dev.azure.com:v3/org/project/repo.');
    info.azure = { org: segs[1], project: segs[2] };
    info.owner = `${segs[1]}/${segs[2]}`;
    info.repo = stripGit(segs[3]);
    return;
  }
  if (h === 'dev.azure.com') {
    org = segs[0] ?? '';
    rest = segs.slice(1);
  } else {
    org = h.slice(0, -'.visualstudio.com'.length);
    rest = segs[0]?.toLowerCase() === 'defaultcollection' ? segs.slice(1) : segs;
  }
  const gi = rest.indexOf('_git');
  if (!org || gi < 0 || !rest[gi + 1]) {
    throw new Error('Azure DevOps repository links look like https://dev.azure.com/org/project/_git/repo.');
  }
  const repo = rest[gi + 1];
  const project = gi > 0 ? rest[gi - 1] : repo;
  info.azure = { org, project };
  info.owner = `${org}/${project}`;
  info.repo = stripGit(repo);
  const after = rest.slice(gi + 2);
  if (after[0] === 'pullrequest') {
    info.kind = 'pull';
    info.number = toNumber(after[1]);
  } else if (after[0] === 'commit') {
    info.kind = 'commit';
    info.commit = after[1] ?? null;
  }
  const path = query.get('path');
  const version = query.get('version');
  if (version) {
    const kind = version.slice(0, 2);
    const value = version.slice(2);
    if (kind === 'GC') info.commit = value;
    else if (kind === 'GB' || kind === 'GT') info.ref = value;
  }
  if (path && path !== '/') {
    info.path = path.replace(/^\/+/, '');
    info.kind = 'blob';
  }
  setLines(info, query.get('line') ?? undefined, query.get('lineEnd') ?? undefined);
}

/** Parse any common Git remote or hosting URL. */
export function parseGitUrl(raw: string): ParseResult {
  let input = raw.trim();
  if (!input) return { ok: false, error: 'Enter a Git URL.' };
  // Accept a pasted "git clone <url> [dir]" command.
  const clone = /^git\s+clone\s+(.+)$/i.exec(input);
  if (clone) {
    const tokens = clone[1].split(/\s+/).filter((tk) => !tk.startsWith('-'));
    input = tokens.find((tk) => /[:/]/.test(tk)) ?? tokens[0] ?? '';
  }
  input = input.replace(/^[<"']+|[>"']+$/g, '');
  if (/\s/.test(input)) return { ok: false, error: 'A Git URL cannot contain spaces. Encode them as %20 or check the pasted text.' };

  const notes: string[] = [];
  let form: UrlForm;
  let user: string | null = null;
  let host: string;
  let port: string | null = null;
  let pathPart: string;
  let query = new URLSearchParams();
  let fragment = '';

  if (/^[\w.-]+\/[\w.-]+$/.test(input) && !input.includes('..') && !BARE_HOST_RE.test(`${input}/`)) {
    // owner/repo shorthand (as used by GitHub CLI and many tools)
    form = 'shorthand';
    host = 'github.com';
    pathPart = input;
    notes.push('Interpreted “owner/repo” shorthand as a GitHub repository.');
  } else {
    if (BARE_HOST_RE.test(input)) input = `https://${input}`;
    const m = SCHEME_URL_RE.exec(input);
    if (m) {
      const scheme = m[1].toLowerCase();
      if (scheme === 'ssh' || scheme === 'git+ssh' || scheme === 'ssh+git') form = 'ssh';
      else if (scheme === 'https' || scheme === 'git+https') form = 'https';
      else if (scheme === 'http' || scheme === 'git+http') form = 'http';
      else if (scheme === 'git') form = 'git';
      else if (scheme === 'file') form = 'file';
      else return { ok: false, error: `“${m[1]}://” is not a Git transport. Use ssh://, https://, git:// or file://.` };
      user = m[2] ? safeDecode(m[2].split(':')[0]) || null : null;
      if (m[2]?.includes(':')) notes.push('The URL contains a password or token. Avoid sharing URLs with embedded credentials.');
      host = m[3].toLowerCase();
      port = m[4] || null;
      pathPart = m[5] ?? '';
      query = new URLSearchParams(m[6]?.slice(1) ?? '');
      fragment = safeDecode(m[7]?.slice(1) ?? '');
      if (form === 'file') {
        const path = safeDecode(pathPart);
        const segs = path.split('/').filter(Boolean);
        const info = empty('file', 'generic', host);
        info.repo = stripGit(segs[segs.length - 1] ?? '');
        info.owner = segs.slice(0, -1).join('/');
        info.path = null;
        info.notes.push('A file:// URL points to a repository on the local disk.');
        if (!info.repo) return { ok: false, error: 'This file:// URL has no repository path.' };
        return { ok: true, info };
      }
      if (!host) return { ok: false, error: 'The URL is missing a host name.' };
    } else {
      const s = SCP_RE.exec(input);
      if (!s) return { ok: false, error: 'This does not look like a Git URL. Try git@host:owner/repo.git or https://host/owner/repo.' };
      if (/^[a-z]$/i.test(s[2]) && !s[1]) return { ok: false, error: 'This looks like a Windows file path. Use a file:// URL for local repositories.' };
      form = 'scp';
      user = s[1] ?? null;
      host = s[2].toLowerCase();
      pathPart = s[3];
      if (!pathPart) return { ok: false, error: 'The SSH address has no repository path after the colon.' };
    }
  }

  const provider = detectProvider(host);
  const info = empty(form, provider, host);
  info.user = user;
  info.port = port;
  info.notes.push(...notes);
  const segs = pathPart.split('/').filter(Boolean).map(safeDecode);

  try {
    switch (provider) {
      case 'github':
        if (host === 'www.github.com' || host === 'ssh.github.com') info.host = 'github.com';
        parseGitHub(info, segs, fragment, host === 'raw.githubusercontent.com');
        break;
      case 'gitlab':
        if (host === 'www.gitlab.com') info.host = 'gitlab.com';
        parseGitLab(info, segs, fragment);
        break;
      case 'bitbucket':
        info.host = 'bitbucket.org';
        parseBitbucket(info, segs, fragment);
        break;
      case 'azure':
        parseAzure(info, host, segs, query);
        break;
      default: {
        if (!segs.length) throw new Error('The URL has no repository path.');
        info.repo = stripGit(segs[segs.length - 1]);
        info.owner = segs.slice(0, -1).join('/');
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not read this URL.' };
  }
  if (!info.repo) return { ok: false, error: 'Could not find a repository name in this URL.' };
  if (form === 'http') info.notes.push('Plain http:// sends data unencrypted; prefer https://.');
  if (form === 'git') info.notes.push('The git:// protocol is unauthenticated and unencrypted; GitHub no longer supports it.');
  return { ok: true, info };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function enc(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

export interface CloneUrls {
  https: string;
  ssh: string;
  web: string;
}

export function cloneUrls(info: GitUrlInfo): CloneUrls {
  const { host, owner, repo } = info;
  const full = owner ? `${owner}/${repo}` : repo;
  if (info.provider === 'azure' && info.azure) {
    const { org, project } = info.azure;
    const base = `https://dev.azure.com/${enc(org)}/${enc(project)}/_git/${enc(repo)}`;
    return { https: base, ssh: `git@ssh.dev.azure.com:v3/${org}/${project}/${repo}`, web: base };
  }
  if (info.form === 'file') {
    const url = `file://${host}/${enc(full)}`;
    return { https: url, ssh: url, web: url };
  }
  const webHost = info.form === 'ssh' || info.form === 'scp' ? host.replace(/^ssh\./, '') : host;
  const httpsPort = info.form === 'https' || info.form === 'http' ? (info.port ? `:${info.port}` : '') : '';
  const web = `https://${webHost}${httpsPort}/${enc(full)}`;
  const sshUser = (info.form === 'ssh' || info.form === 'scp') && info.user ? info.user : 'git';
  const sshPort = info.form === 'ssh' && info.port ? info.port : null;
  const sshHost = info.form === 'ssh' || info.form === 'scp' ? host : webHost;
  const ssh = sshPort ? `ssh://${sshUser}@${sshHost}:${sshPort}/${full}.git` : `${sshUser}@${sshHost}:${full}.git`;
  return { https: `${web}.git`, ssh, web };
}

export interface LinkParams {
  ref: string;
  path: string;
  lineStart: number | null;
  lineEnd: number | null;
  commit: string;
}

export interface GeneratedLink {
  id: 'file' | 'tree' | 'raw' | 'blame' | 'permalink' | 'commit';
  label: string;
  url: string;
}

function lineFragment(provider: Provider, a: number | null, b: number | null): string {
  if (a === null) return '';
  const end = b !== null && b > a ? b : null;
  switch (provider) {
    case 'github':
      return end ? `#L${a}-L${end}` : `#L${a}`;
    case 'gitlab':
      return end ? `#L${a}-${end}` : `#L${a}`;
    case 'bitbucket':
      return end ? `#lines-${a}:${end}` : `#lines-${a}`;
    default:
      return '';
  }
}

/** Links to a file (or folder) for providers with a known URL scheme. */
export function fileLinks(info: GitUrlInfo, params: LinkParams): GeneratedLink[] {
  const ref = params.ref.trim();
  const path = params.path.trim().replace(/^\/+/, '');
  const commit = params.commit.trim();
  const { web } = cloneUrls(info);
  const lines = lineFragment(info.provider, params.lineStart, params.lineEnd);
  const out: GeneratedLink[] = [];
  const add = (id: GeneratedLink['id'], label: string, url: string) => out.push({ id, label, url });
  switch (info.provider) {
    case 'github': {
      if (ref && path) {
        add('file', 'File', `${web}/blob/${enc(ref)}/${enc(path)}${lines}`);
        add(
          'raw',
          'Raw',
          info.host === 'github.com'
            ? `https://raw.githubusercontent.com/${enc(info.owner)}/${enc(info.repo)}/${enc(ref)}/${enc(path)}`
            : `${web}/raw/${enc(ref)}/${enc(path)}`,
        );
        add('blame', 'Blame', `${web}/blame/${enc(ref)}/${enc(path)}${lines}`);
      } else if (ref) add('tree', 'Branch / tree', `${web}/tree/${enc(ref)}`);
      if (commit && path) add('permalink', 'Permalink', `${web}/blob/${enc(commit)}/${enc(path)}${lines}`);
      if (commit) add('commit', 'Commit', `${web}/commit/${enc(commit)}`);
      break;
    }
    case 'gitlab': {
      if (ref && path) {
        add('file', 'File', `${web}/-/blob/${enc(ref)}/${enc(path)}${lines}`);
        add('raw', 'Raw', `${web}/-/raw/${enc(ref)}/${enc(path)}`);
        add('blame', 'Blame', `${web}/-/blame/${enc(ref)}/${enc(path)}${lines}`);
      } else if (ref) add('tree', 'Branch / tree', `${web}/-/tree/${enc(ref)}`);
      if (commit && path) add('permalink', 'Permalink', `${web}/-/blob/${enc(commit)}/${enc(path)}${lines}`);
      if (commit) add('commit', 'Commit', `${web}/-/commit/${enc(commit)}`);
      break;
    }
    case 'bitbucket': {
      if (ref && path) {
        add('file', 'File', `${web}/src/${enc(ref)}/${enc(path)}${lines}`);
        add('raw', 'Raw', `${web}/raw/${enc(ref)}/${enc(path)}`);
      } else if (ref) add('tree', 'Branch / tree', `${web}/src/${enc(ref)}/`);
      if (commit && path) add('permalink', 'Permalink', `${web}/src/${enc(commit)}/${enc(path)}${lines}`);
      if (commit) add('commit', 'Commit', `${web}/commits/${enc(commit)}`);
      break;
    }
    case 'azure': {
      const q = (version: string) => {
        const p = new URLSearchParams();
        if (path) p.set('path', `/${path}`);
        p.set('version', version);
        if (path && params.lineStart !== null) {
          p.set('line', String(params.lineStart));
          p.set('lineEnd', String(params.lineEnd ?? params.lineStart));
          p.set('lineStartColumn', '1');
          p.set('lineEndColumn', '1');
        }
        return `${web}?${p.toString()}`;
      };
      if (ref) add(path ? 'file' : 'tree', path ? 'File' : 'Branch / tree', q(`GB${ref}`));
      if (commit && path) add('permalink', 'Permalink', q(`GC${commit}`));
      if (commit) add('commit', 'Commit', `${web}/commit/${enc(commit)}`);
      break;
    }
    default:
      break;
  }
  return out;
}

/** Whether `fileLinks` knows the URL scheme for this provider. */
export function supportsFileLinks(info: GitUrlInfo): boolean {
  return info.provider !== 'generic' && info.form !== 'file';
}
