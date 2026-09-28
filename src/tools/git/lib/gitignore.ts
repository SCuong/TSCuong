/**
 * Curated .gitignore templates and a merger that removes duplicate patterns
 * across templates.
 */

export type TemplateGroup = 'Languages' | 'Frameworks' | 'Operating systems' | 'Editors & IDEs' | 'Tools';

export interface GitignoreTemplate {
  id: string;
  name: string;
  group: TemplateGroup;
  keywords: string[];
  content: string;
}

const t = (id: string, name: string, group: TemplateGroup, keywords: string[], lines: string[]): GitignoreTemplate => ({
  id,
  name,
  group,
  keywords,
  content: lines.join('\n'),
});

export const GITIGNORE_TEMPLATES: GitignoreTemplate[] = [
  // ---- Languages ----------------------------------------------------------
  t('node', 'Node', 'Languages', ['javascript', 'typescript', 'npm', 'yarn', 'pnpm', 'js', 'ts'], [
    '# Dependencies',
    'node_modules/',
    '.pnp',
    '.pnp.*',
    '.yarn/*',
    '!.yarn/patches',
    '!.yarn/plugins',
    '!.yarn/releases',
    '!.yarn/versions',
    '',
    '# Logs',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    'pnpm-debug.log*',
    '',
    '# Build output and caches',
    'dist/',
    'build/',
    'coverage/',
    '.npm/',
    '.eslintcache',
    '*.tsbuildinfo',
    '',
    '# Environment',
    '.env',
    '.env.*',
    '!.env.example',
  ]),
  t('python', 'Python', 'Languages', ['py', 'pip', 'venv', 'virtualenv', 'poetry', 'pytest', 'jupyter'], [
    '# Byte-compiled files',
    '__pycache__/',
    '*.py[cod]',
    '*$py.class',
    '',
    '# Packaging',
    'build/',
    'dist/',
    '*.egg-info/',
    '.eggs/',
    'wheels/',
    '',
    '# Virtual environments',
    '.venv/',
    'venv/',
    'env/',
    '',
    '# Tests and tooling caches',
    '.pytest_cache/',
    '.tox/',
    '.nox/',
    '.coverage',
    '.coverage.*',
    'htmlcov/',
    '.mypy_cache/',
    '.ruff_cache/',
    '',
    '# Jupyter',
    '.ipynb_checkpoints/',
    '',
    '# Environment',
    '.env',
  ]),
  t('java', 'Java', 'Languages', ['jvm', 'jar', 'class'], [
    '# Compiled files',
    '*.class',
    '',
    '# Packages',
    '*.jar',
    '*.war',
    '*.ear',
    '*.nar',
    '',
    '# Logs and crash dumps',
    '*.log',
    'hs_err_pid*',
    'replay_pid*',
  ]),
  t('kotlin', 'Kotlin', 'Languages', ['kt', 'jvm'], ['*.class', '*.jar', '.kotlin/', 'hs_err_pid*']),
  t('go', 'Go', 'Languages', ['golang'], [
    '# Binaries',
    '*.exe',
    '*.exe~',
    '*.dll',
    '*.so',
    '*.dylib',
    '',
    '# Test binaries and coverage',
    '*.test',
    '*.out',
    'coverage.*',
    '',
    '# Workspace file',
    'go.work',
    'go.work.sum',
  ]),
  t('rust', 'Rust', 'Languages', ['cargo', 'rs'], [
    '# Build output',
    'target/',
    '',
    '# Backup files from rustfmt',
    '**/*.rs.bk',
    '',
    '# Debug information on Windows',
    '*.pdb',
  ]),
  t('c', 'C', 'Languages', ['gcc', 'clang', 'make'], [
    '# Object files',
    '*.o',
    '*.ko',
    '*.obj',
    '*.elf',
    '',
    '# Precompiled headers',
    '*.gch',
    '*.pch',
    '',
    '# Libraries',
    '*.a',
    '*.lib',
    '*.so',
    '*.so.*',
    '*.dylib',
    '*.dll',
    '',
    '# Executables',
    '*.exe',
    '*.out',
    '*.app',
    '',
    '# Debug files',
    '*.dSYM/',
    '*.pdb',
    '*.ilk',
  ]),
  t('cpp', 'C++', 'Languages', ['cpp', 'cmake', 'cxx'], [
    '# Object files',
    '*.o',
    '*.obj',
    '',
    '# Precompiled headers',
    '*.gch',
    '*.pch',
    '',
    '# Libraries',
    '*.a',
    '*.lib',
    '*.so',
    '*.dylib',
    '*.dll',
    '',
    '# Executables',
    '*.exe',
    '*.out',
    '*.app',
    '',
    '# CMake',
    'build/',
    'cmake-build-*/',
    'CMakeCache.txt',
    'CMakeFiles/',
    'CMakeUserPresets.json',
    'compile_commands.json',
  ]),
  t('dotnet', '.NET / C#', 'Languages', ['csharp', 'c#', 'visual studio', 'nuget', 'fsharp', 'vb'], [
    '# Build results',
    '[Bb]in/',
    '[Oo]bj/',
    '[Dd]ebug/',
    '[Rr]elease/',
    'x64/',
    'x86/',
    '[Ll]og/',
    '',
    '# Visual Studio',
    '.vs/',
    '*.user',
    '*.suo',
    '*.userprefs',
    '',
    '# NuGet',
    '*.nupkg',
    '*.snupkg',
    '**/packages/*',
    '!**/packages/build/',
    '',
    '# Test results',
    'TestResults/',
    '*.trx',
  ]),
  t('ruby', 'Ruby', 'Languages', ['gem', 'bundler', 'rb'], [
    '*.gem',
    '.bundle/',
    'vendor/bundle/',
    'coverage/',
    '.byebug_history',
    '.rspec_status',
    '/tmp/',
    '/log/',
  ]),
  t('php', 'PHP / Composer', 'Languages', ['composer', 'phpunit'], ['/vendor/', '.phpunit.result.cache', '.phpunit.cache/', '.php-cs-fixer.cache']),
  t('dart', 'Dart / Flutter', 'Languages', ['flutter', 'pub'], [
    '.dart_tool/',
    '.packages',
    '.pub-cache/',
    '.pub/',
    'build/',
    '.flutter-plugins',
    '.flutter-plugins-dependencies',
  ]),
  t('swift', 'Swift Package Manager', 'Languages', ['swiftpm', 'spm'], ['.build/', '/Packages', '.swiftpm/', 'Package.resolved']),

  // ---- Frameworks ---------------------------------------------------------
  t('nextjs', 'Next.js', 'Frameworks', ['next', 'react', 'vercel'], [
    '/.next/',
    '/out/',
    'next-env.d.ts',
    '.vercel',
    '*.tsbuildinfo',
  ]),
  t('nuxt', 'Nuxt', 'Frameworks', ['vue', 'nuxtjs'], ['.nuxt/', '.output/', '.data/', '.nitro/', '.cache/', 'dist/']),
  t('vite', 'Vite', 'Frameworks', ['react', 'vue', 'svelte', 'vitest'], ['dist/', 'dist-ssr/', '*.local', '.vite/', 'coverage/']),
  t('angular', 'Angular', 'Frameworks', ['ng'], ['/dist/', '/.angular/cache/', '/out-tsc/', '/bazel-out/']),
  t('django', 'Django', 'Frameworks', ['python', 'web'], ['*.log', 'local_settings.py', 'db.sqlite3', 'db.sqlite3-journal', 'media/', 'staticfiles/']),
  t('laravel', 'Laravel', 'Frameworks', ['php'], [
    '/vendor/',
    '/node_modules/',
    '/public/build/',
    '/public/hot',
    '/public/storage/',
    '/storage/*.key',
    '.env',
    '.env.backup',
    '.phpunit.result.cache',
  ]),
  t('rails', 'Ruby on Rails', 'Frameworks', ['ruby', 'rails'], [
    '/.bundle/',
    '/log/*',
    '!/log/.keep',
    '/tmp/*',
    '!/tmp/.keep',
    '/storage/*',
    '!/storage/.keep',
    '/public/assets/',
    '/config/master.key',
    '/config/credentials/*.key',
  ]),
  t('hugo', 'Hugo', 'Frameworks', ['static site'], ['/public/', '/resources/_gen/', '/assets/jsconfig.json', '.hugo_build.lock']),
  t('jekyll', 'Jekyll', 'Frameworks', ['static site', 'github pages'], ['_site/', '.sass-cache/', '.jekyll-cache/', '.jekyll-metadata', 'vendor/']),
  t('unity', 'Unity', 'Frameworks', ['game', 'csharp'], [
    '/[Ll]ibrary/',
    '/[Tt]emp/',
    '/[Oo]bj/',
    '/[Bb]uild/',
    '/[Bb]uilds/',
    '/[Ll]ogs/',
    '/[Uu]ser[Ss]ettings/',
    '/[Mm]emoryCaptures/',
    '',
    '# Generated project files',
    '.vs/',
    '*.csproj',
    '*.sln',
    '*.pidb',
    '*.booproj',
    '*.unityproj',
    '',
    '# Crash reports and builds',
    'sysinfo.txt',
    '*.apk',
    '*.aab',
    '*.unitypackage',
    'crashlytics-build.properties',
  ]),
  t('unreal', 'Unreal Engine', 'Frameworks', ['game', 'ue4', 'ue5'], [
    'Binaries/',
    'DerivedDataCache/',
    'Intermediate/',
    'Saved/',
    '.vs/',
    '*.sln',
    '*.VC.db',
  ]),
  t('android', 'Android', 'Frameworks', ['gradle', 'kotlin', 'mobile'], [
    '# Gradle and build output',
    '.gradle/',
    'build/',
    '/captures',
    '.externalNativeBuild/',
    '.cxx/',
    '',
    '# Local configuration (SDK path)',
    'local.properties',
    '',
    '# Packages and signing',
    '*.apk',
    '*.aab',
    '*.ap_',
    '*.jks',
    '*.keystore',
    '',
    '# Android Studio',
    '*.iml',
    '.idea/',
  ]),
  t('xcode', 'iOS / Xcode', 'Frameworks', ['ios', 'macos', 'swift', 'objective-c', 'cocoapods', 'mobile'], [
    '# Xcode user state',
    'xcuserdata/',
    '*.xcscmblueprint',
    '*.xccheckout',
    '',
    '# Build output',
    'build/',
    'DerivedData/',
    '*.ipa',
    '*.dSYM.zip',
    '*.dSYM',
    '',
    '# Dependencies',
    'Pods/',
    'Carthage/Build/',
    '',
    '# fastlane',
    'fastlane/report.xml',
    'fastlane/Preview.html',
    'fastlane/screenshots/**/*.png',
    'fastlane/test_output',
  ]),

  // ---- Tools --------------------------------------------------------------
  t('gradle', 'Gradle', 'Tools', ['java', 'kotlin', 'android'], ['.gradle/', 'build/', '!gradle/wrapper/gradle-wrapper.jar', '.gradletasknamecache']),
  t('maven', 'Maven', 'Tools', ['java', 'pom'], [
    'target/',
    'pom.xml.tag',
    'pom.xml.releaseBackup',
    'pom.xml.versionsBackup',
    'pom.xml.next',
    'release.properties',
    'dependency-reduced-pom.xml',
    '.mvn/wrapper/maven-wrapper.jar',
  ]),
  t('terraform', 'Terraform', 'Tools', ['tf', 'hcl', 'infrastructure', 'opentofu'], [
    '# Local .terraform directories',
    '**/.terraform/*',
    '',
    '# State files (may contain secrets)',
    '*.tfstate',
    '*.tfstate.*',
    '',
    '# Crash logs',
    'crash.log',
    'crash.*.log',
    '',
    '# Variable files (often contain secrets)',
    '*.tfvars',
    '*.tfvars.json',
    '',
    '# Local overrides',
    'override.tf',
    'override.tf.json',
    '*_override.tf',
    '*_override.tf.json',
    '',
    '# CLI configuration',
    '.terraformrc',
    'terraform.rc',
  ]),
  t('docker', 'Docker', 'Tools', ['container', 'compose'], ['.docker/', 'docker-compose.override.yml', '*.env.local']),
  t('dotenv', 'Environment files', 'Tools', ['env', 'secrets', 'dotenv'], ['.env', '.env.*', '!.env.example', '*.local']),
  t('logs', 'Logs and temp files', 'Tools', ['log', 'tmp', 'temp', 'cache'], ['*.log', 'logs/', '*.tmp', '*.temp', '*.bak', '*.swp', 'tmp/', '.cache/']),
  t('archives', 'Archives', 'Tools', ['zip', 'tar', 'compressed'], ['*.zip', '*.tar', '*.tar.gz', '*.tgz', '*.gz', '*.7z', '*.rar', '*.bz2', '*.xz']),

  // ---- Operating systems --------------------------------------------------
  t('macos', 'macOS', 'Operating systems', ['mac', 'osx', 'apple', 'ds_store'], [
    '.DS_Store',
    '.AppleDouble',
    '.LSOverride',
    '._*',
    '.Spotlight-V100',
    '.Trashes',
    '.fseventsd',
    '.DocumentRevisions-V100',
    '.TemporaryItems',
  ]),
  t('windows', 'Windows', 'Operating systems', ['win', 'thumbs.db', 'desktop.ini'], [
    'Thumbs.db',
    'Thumbs.db:encryptable',
    'ehthumbs.db',
    'ehthumbs_vista.db',
    'Desktop.ini',
    '$RECYCLE.BIN/',
    '*.lnk',
    '*.stackdump',
  ]),
  t('linux', 'Linux', 'Operating systems', ['unix'], ['*~', '.fuse_hidden*', '.directory', '.Trash-*', '.nfs*']),

  // ---- Editors & IDEs -----------------------------------------------------
  t('jetbrains', 'JetBrains', 'Editors & IDEs', ['intellij', 'idea', 'webstorm', 'pycharm', 'rider', 'goland', 'clion', 'phpstorm'], [
    '.idea/',
    '*.iml',
    '*.ipr',
    '*.iws',
    'out/',
    '.idea_modules/',
  ]),
  t('vscode', 'VS Code', 'Editors & IDEs', ['visual studio code', 'vscode', 'code'], [
    '.vscode/*',
    '!.vscode/settings.json',
    '!.vscode/tasks.json',
    '!.vscode/launch.json',
    '!.vscode/extensions.json',
    '*.code-workspace',
    '.history/',
  ]),
  t('vim', 'Vim', 'Editors & IDEs', ['neovim', 'nvim', 'swap'], ['[._]*.s[a-v][a-z]', '[._]*.sw[a-p]', '[._]s[a-rt-v][a-z]', '[._]ss[a-gi-z]', '[._]sw[a-p]', 'Session.vim', 'Sessionx.vim', '.netrwhist', '*~', 'tags']),
  t('emacs', 'Emacs', 'Editors & IDEs', ['emacs'], ['*~', '\\#*\\#', '/.emacs.desktop', '/.emacs.desktop.lock', '*.elc', '.#*', 'auto-save-list', 'tramp']),
  t('sublime', 'Sublime Text', 'Editors & IDEs', ['sublime'], ['*.sublime-workspace', '*.tmlanguage.cache', '*.tmPreferences.cache', '*.stTheme.cache']),
  t('visualstudio', 'Visual Studio', 'Editors & IDEs', ['vs', 'msvc'], ['.vs/', '*.user', '*.suo', '*.sdf', '*.opensdf', '*.VC.db', 'ipch/']),
];

export const TEMPLATE_GROUPS: TemplateGroup[] = ['Languages', 'Frameworks', 'Tools', 'Operating systems', 'Editors & IDEs'];

const byId = new Map(GITIGNORE_TEMPLATES.map((tpl) => [tpl.id, tpl]));

export function getTemplate(id: string): GitignoreTemplate | undefined {
  return byId.get(id);
}

/** Case-insensitive search over name, id and keywords. */
export function searchTemplates(query: string): GitignoreTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return GITIGNORE_TEMPLATES;
  return GITIGNORE_TEMPLATES.filter(
    (tpl) => tpl.name.toLowerCase().includes(q) || tpl.id.includes(q) || tpl.keywords.some((k) => k.includes(q)),
  );
}

/** A pattern line normalised for duplicate detection (trailing spaces are not significant unless escaped). */
function patternKey(line: string): string {
  return line.replace(/(?<!\\)\s+$/, '');
}

function isPattern(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

export interface MergeResult {
  text: string;
  /** Patterns skipped because an earlier section already contains them. */
  duplicates: number;
  patterns: number;
}

/**
 * Merge templates (in the given order) and custom lines into one .gitignore.
 * Each pattern appears once; comment headings whose patterns were all
 * duplicates are dropped too.
 */
export function mergeGitignore(ids: string[], custom = '', options: { headers?: boolean } = {}): MergeResult {
  const headers = options.headers ?? true;
  const seen = new Set<string>();
  const sections: string[] = [];
  let duplicates = 0;

  const addSection = (title: string, content: string, keepComments = false) => {
    const out: string[] = [];
    let pendingComments: string[] = [];
    for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
      if (raw.trim() === '') {
        pendingComments = [];
        if (out.length && out[out.length - 1] !== '') out.push('');
        continue;
      }
      if (!isPattern(raw)) {
        if (keepComments) out.push(raw.trimEnd());
        else pendingComments.push(raw.trimEnd());
        continue;
      }
      const key = patternKey(raw);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      if (pendingComments.length) {
        out.push(...pendingComments);
        pendingComments = [];
      }
      out.push(key);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    if (!out.length) return;
    sections.push(headers ? [`# ===== ${title} =====`, ...out].join('\n') : out.join('\n'));
  };

  for (const id of [...new Set(ids)]) {
    const tpl = byId.get(id);
    if (tpl) addSection(tpl.name, tpl.content);
  }
  if (custom.trim()) addSection('Custom', custom, true);
  const text = sections.length ? `${sections.join('\n\n')}\n` : '';
  return { text, duplicates, patterns: seen.size };
}
