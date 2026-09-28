import { describe, expect, it } from 'vitest';
import { cloneUrls, fileLinks, parseGitUrl, supportsFileLinks, type GitUrlInfo, type LinkParams } from './gitUrl';

function parse(url: string): GitUrlInfo {
  const r = parseGitUrl(url);
  if (!r.ok) throw new Error(`expected ${url} to parse: ${r.error}`);
  return r.info;
}

function error(url: string): string {
  const r = parseGitUrl(url);
  if (r.ok) throw new Error(`expected ${url} to fail`);
  return r.error;
}

describe('parseGitUrl: clone URL matrix', () => {
  const cases: Array<[string, Partial<GitUrlInfo>]> = [
    ['git@github.com:octo/hello-world.git', { form: 'scp', provider: 'github', host: 'github.com', user: 'git', owner: 'octo', repo: 'hello-world' }],
    ['git@github.com:octo/hello-world', { form: 'scp', owner: 'octo', repo: 'hello-world' }],
    ['ssh://git@github.com/octo/hello.git', { form: 'ssh', provider: 'github', owner: 'octo', repo: 'hello', port: null }],
    ['ssh://git@ssh.github.com:443/octo/hello.git', { form: 'ssh', host: 'github.com', port: '443', repo: 'hello' }],
    ['git+ssh://git@example.com:2222/team/app.git', { form: 'ssh', provider: 'generic', host: 'example.com', port: '2222', owner: 'team', repo: 'app' }],
    ['https://github.com/octo/hello.git', { form: 'https', provider: 'github', owner: 'octo', repo: 'hello', kind: 'repo' }],
    ['https://www.github.com/octo/hello', { host: 'github.com', repo: 'hello' }],
    ['http://git.example.org/repos/tool.git', { form: 'http', provider: 'generic', owner: 'repos', repo: 'tool' }],
    ['git://git.kernel.org/pub/scm/git/git.git', { form: 'git', owner: 'pub/scm/git', repo: 'git' }],
    ['https://gitlab.com/group/sub/deep/project.git', { provider: 'gitlab', owner: 'group/sub/deep', repo: 'project' }],
    ['git@gitlab.example.com:team/proj.git', { provider: 'gitlab', host: 'gitlab.example.com', owner: 'team', repo: 'proj' }],
    ['https://alice@bitbucket.org/acme/widgets.git', { provider: 'bitbucket', user: 'alice', owner: 'acme', repo: 'widgets' }],
    ['git@bitbucket.org:acme/widgets.git', { provider: 'bitbucket', owner: 'acme', repo: 'widgets' }],
    ['user@server:/srv/git/project.git', { form: 'scp', provider: 'generic', user: 'user', owner: 'srv/git', repo: 'project' }],
    ['server:project.git', { form: 'scp', user: null, host: 'server', owner: '', repo: 'project' }],
    ['file:///home/me/repos/site.git', { form: 'file', repo: 'site', owner: 'home/me/repos' }],
    ['github.com/octo/hello', { form: 'https', provider: 'github', owner: 'octo', repo: 'hello' }],
    ['octo/hello', { form: 'shorthand', provider: 'github', owner: 'octo', repo: 'hello' }],
    ['git clone --depth 1 git@github.com:octo/hello.git mydir', { owner: 'octo', repo: 'hello' }],
    ['<https://github.com/octo/hello>', { repo: 'hello' }],
    ['ssh://git@[::1]:2222/x/y.git', { host: '[::1]', port: '2222', owner: 'x', repo: 'y' }],
  ];
  it.each(cases)('%s', (url, expected) => {
    expect(parse(url)).toMatchObject(expected);
  });
});

describe('parseGitUrl: Azure DevOps', () => {
  it('parses https, legacy and ssh forms', () => {
    expect(parse('https://dev.azure.com/contoso/Fabrikam/_git/Web')).toMatchObject({
      provider: 'azure',
      owner: 'contoso/Fabrikam',
      repo: 'Web',
      azure: { org: 'contoso', project: 'Fabrikam' },
    });
    expect(parse('https://contoso@dev.azure.com/contoso/Fabrikam/_git/Web').user).toBe('contoso');
    expect(parse('https://contoso.visualstudio.com/DefaultCollection/Fabrikam/_git/Web').azure).toEqual({ org: 'contoso', project: 'Fabrikam' });
    expect(parse('git@ssh.dev.azure.com:v3/contoso/Fabrikam/Web')).toMatchObject({ owner: 'contoso/Fabrikam', repo: 'Web' });
    expect(parse('https://dev.azure.com/contoso/_git/Solo').azure).toEqual({ org: 'contoso', project: 'Solo' });
  });
  it('reads path, version and line query parameters', () => {
    const info = parse('https://dev.azure.com/o/p/_git/r?path=/src/app.ts&version=GBdev&line=5&lineEnd=9&lineStartColumn=1');
    expect(info).toMatchObject({ kind: 'blob', path: 'src/app.ts', ref: 'dev', lineStart: 5, lineEnd: 9 });
    expect(parse('https://dev.azure.com/o/p/_git/r?version=GCabc1234').commit).toBe('abc1234');
    expect(parse('https://dev.azure.com/o/p/_git/r/pullrequest/77')).toMatchObject({ kind: 'pull', number: 77 });
  });
  it('explains malformed Azure URLs', () => {
    expect(error('https://dev.azure.com/o/p')).toMatch(/_git/);
    expect(error('git@ssh.dev.azure.com:v3/o/p')).toMatch(/v3\/org\/project\/repo/);
  });
});

describe('parseGitUrl: web links', () => {
  it('GitHub blob with line range', () => {
    expect(parse('https://github.com/octo/hello/blob/main/src/index.ts#L10-L20')).toMatchObject({
      kind: 'blob',
      ref: 'main',
      path: 'src/index.ts',
      lineStart: 10,
      lineEnd: 20,
    });
    expect(parse('https://github.com/octo/hello/blob/main/a.md#L7')).toMatchObject({ lineStart: 7, lineEnd: null });
    expect(parse('https://github.com/o/r/blob/main/a#L3C2-L5C9')).toMatchObject({ lineStart: 3, lineEnd: 5 });
    expect(parse('https://github.com/o/r/blob/main/a#L9-L3')).toMatchObject({ lineStart: 3, lineEnd: 9 });
  });
  it('GitHub tree, blame, commit, PR, issue, compare, release', () => {
    expect(parse('https://github.com/o/r/tree/dev')).toMatchObject({ kind: 'tree', ref: 'dev', path: null });
    expect(parse('https://github.com/o/r/blame/v1.2.0/lib/x.js')).toMatchObject({ kind: 'blame', ref: 'v1.2.0', path: 'lib/x.js' });
    const sha = 'a'.repeat(40);
    expect(parse(`https://github.com/o/r/commit/${sha}`)).toMatchObject({ kind: 'commit', commit: sha });
    expect(parse(`https://github.com/o/r/blob/${sha}/x`)).toMatchObject({ commit: sha, ref: sha });
    expect(parse('https://github.com/o/r/pull/42/files')).toMatchObject({ kind: 'pull', number: 42 });
    expect(parse('https://github.com/o/r/issues/7')).toMatchObject({ kind: 'issue', number: 7 });
    expect(parse('https://github.com/o/r/compare/main...feature/x')).toMatchObject({ kind: 'compare', ref: 'main...feature/x' });
    expect(parse('https://github.com/o/r/releases/tag/v2.0.0')).toMatchObject({ kind: 'release', ref: 'v2.0.0' });
  });
  it('raw.githubusercontent.com incl. refs/heads', () => {
    expect(parse('https://raw.githubusercontent.com/o/r/main/docs/README.md')).toMatchObject({
      host: 'github.com',
      kind: 'raw',
      ref: 'main',
      path: 'docs/README.md',
    });
    expect(parse('https://raw.githubusercontent.com/o/r/refs/heads/dev/a.txt')).toMatchObject({ ref: 'dev', path: 'a.txt' });
  });
  it('decodes percent-encoded and unicode paths', () => {
    expect(parse('https://github.com/o/r/blob/main/docs/t%C3%A0i%20li%E1%BB%87u.md').path).toBe('docs/tài liệu.md');
  });
  it('GitLab with /-/ routes and subgroups', () => {
    expect(parse('https://gitlab.com/g/sub/proj/-/blob/main/src/a.py#L3-8')).toMatchObject({
      owner: 'g/sub',
      repo: 'proj',
      kind: 'blob',
      ref: 'main',
      path: 'src/a.py',
      lineStart: 3,
      lineEnd: 8,
    });
    expect(parse('https://gitlab.com/g/proj/-/merge_requests/12')).toMatchObject({ kind: 'pull', number: 12 });
    expect(parse('https://gitlab.com/g/proj/-/commit/abcdef1')).toMatchObject({ kind: 'commit', commit: 'abcdef1' });
    expect(parse('https://gitlab.com/g/proj/-/tree/dev')).toMatchObject({ kind: 'tree', ref: 'dev' });
  });
  it('Bitbucket src, raw, commits and PRs', () => {
    expect(parse('https://bitbucket.org/ws/repo/src/main/app/x.go#lines-4:9')).toMatchObject({
      kind: 'blob',
      ref: 'main',
      path: 'app/x.go',
      lineStart: 4,
      lineEnd: 9,
    });
    expect(parse('https://bitbucket.org/ws/repo/src/main')).toMatchObject({ kind: 'tree', ref: 'main' });
    expect(parse('https://bitbucket.org/ws/repo/commits/0123abcd')).toMatchObject({ kind: 'commit', commit: '0123abcd' });
    expect(parse('https://bitbucket.org/ws/repo/pull-requests/3')).toMatchObject({ kind: 'pull', number: 3 });
  });
  it('adds a note about ambiguous branch/path splits', () => {
    expect(parse('https://github.com/o/r/blob/main/a/b.ts').notes.join(' ')).toMatch(/Branch names containing/);
  });
});

describe('parseGitUrl: errors and notes', () => {
  it('rejects empty, spaces, unknown schemes and nonsense', () => {
    expect(error('')).toBe('Enter a Git URL.');
    expect(error('https://github.com/o/my repo')).toMatch(/spaces/);
    expect(error('ftp://host/x.git')).toMatch(/not a Git transport/);
    expect(error('hello')).toMatch(/does not look like a Git URL/);
    expect(error('https://github.com/octo')).toMatch(/owner and a repository/);
    expect(error('https://gitlab.com/solo')).toMatch(/group and a project/);
    expect(error('C:\\repos\\x')).toMatch(/Windows file path/);
    expect(error('host:')).toMatch(/no repository path/);
    expect(error('https:///x')).toMatch(/missing a host/);
  });
  it('warns about credentials and insecure protocols', () => {
    expect(parse('https://me:token123@github.com/o/r.git').notes.join(' ')).toMatch(/password or token/);
    expect(parse('http://example.com/a/b.git').notes.join(' ')).toMatch(/unencrypted/);
    expect(parse('git://example.com/a/b.git').notes.join(' ')).toMatch(/git:\/\//);
  });
});

describe('cloneUrls', () => {
  it('converts between SSH and HTTPS', () => {
    expect(cloneUrls(parse('git@github.com:octo/hello.git'))).toEqual({
      https: 'https://github.com/octo/hello.git',
      ssh: 'git@github.com:octo/hello.git',
      web: 'https://github.com/octo/hello',
    });
    expect(cloneUrls(parse('https://github.com/octo/hello/blob/main/x')).ssh).toBe('git@github.com:octo/hello.git');
    expect(cloneUrls(parse('https://gitlab.com/g/s/p')).ssh).toBe('git@gitlab.com:g/s/p.git');
  });
  it('keeps custom SSH ports and users', () => {
    const u = cloneUrls(parse('ssh://deploy@example.com:2222/team/app.git'));
    expect(u.ssh).toBe('ssh://deploy@example.com:2222/team/app.git');
    expect(u.https).toBe('https://example.com/team/app.git');
  });
  it('builds Azure DevOps clone URLs', () => {
    expect(cloneUrls(parse('git@ssh.dev.azure.com:v3/contoso/Fabrikam/Web'))).toEqual({
      https: 'https://dev.azure.com/contoso/Fabrikam/_git/Web',
      ssh: 'git@ssh.dev.azure.com:v3/contoso/Fabrikam/Web',
      web: 'https://dev.azure.com/contoso/Fabrikam/_git/Web',
    });
  });
  it('encodes special characters in web URLs', () => {
    expect(cloneUrls(parse('https://dev.azure.com/org/My%20Project/_git/Repo')).https).toBe('https://dev.azure.com/org/My%20Project/_git/Repo');
  });
});

describe('fileLinks', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const params: LinkParams = { ref: 'main', path: 'src/app.ts', lineStart: 10, lineEnd: 20, commit: sha };
  const urls = (url: string, p = params) => Object.fromEntries(fileLinks(parse(url), p).map((l) => [l.id, l.url]));

  it('GitHub', () => {
    expect(urls('git@github.com:o/r.git')).toEqual({
      file: 'https://github.com/o/r/blob/main/src/app.ts#L10-L20',
      raw: 'https://raw.githubusercontent.com/o/r/main/src/app.ts',
      blame: 'https://github.com/o/r/blame/main/src/app.ts#L10-L20',
      permalink: `https://github.com/o/r/blob/${sha}/src/app.ts#L10-L20`,
      commit: `https://github.com/o/r/commit/${sha}`,
    });
    expect(urls('https://github.com/o/r', { ...params, lineEnd: null }).file).toBe('https://github.com/o/r/blob/main/src/app.ts#L10');
    expect(urls('https://github.com/o/r', { ...params, path: '', commit: '' })).toEqual({ tree: 'https://github.com/o/r/tree/main' });
  });
  it('GitHub Enterprise uses /raw/ on the same host', () => {
    expect(urls('https://github.acme.com/o/r').raw).toBe('https://github.acme.com/o/r/raw/main/src/app.ts');
  });
  it('GitLab', () => {
    expect(urls('https://gitlab.com/g/s/p')).toEqual({
      file: 'https://gitlab.com/g/s/p/-/blob/main/src/app.ts#L10-20',
      raw: 'https://gitlab.com/g/s/p/-/raw/main/src/app.ts',
      blame: 'https://gitlab.com/g/s/p/-/blame/main/src/app.ts#L10-20',
      permalink: `https://gitlab.com/g/s/p/-/blob/${sha}/src/app.ts#L10-20`,
      commit: `https://gitlab.com/g/s/p/-/commit/${sha}`,
    });
  });
  it('Bitbucket', () => {
    expect(urls('git@bitbucket.org:ws/r.git')).toMatchObject({
      file: 'https://bitbucket.org/ws/r/src/main/src/app.ts#lines-10:20',
      raw: 'https://bitbucket.org/ws/r/raw/main/src/app.ts',
      commit: `https://bitbucket.org/ws/r/commits/${sha}`,
    });
  });
  it('Azure DevOps', () => {
    const u = urls('https://dev.azure.com/o/p/_git/r');
    expect(u.file).toBe(
      'https://dev.azure.com/o/p/_git/r?path=%2Fsrc%2Fapp.ts&version=GBmain&line=10&lineEnd=20&lineStartColumn=1&lineEndColumn=1',
    );
    expect(u.permalink).toContain(`version=GC${sha}`);
  });
  it('encodes spaces and unicode in paths and refs', () => {
    expect(urls('https://github.com/o/r', { ...params, ref: 'feature/x', path: 'docs/tài liệu.md', commit: '' }).file).toBe(
      'https://github.com/o/r/blob/feature/x/docs/t%C3%A0i%20li%E1%BB%87u.md#L10-L20',
    );
  });
  it('produces nothing for unknown hosts', () => {
    const info = parse('git@example.com:a/b.git');
    expect(supportsFileLinks(info)).toBe(false);
    expect(fileLinks(info, params)).toEqual([]);
  });
});
