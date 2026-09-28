/**
 * A task-oriented Git cheat sheet. Placeholders are written in <angle-brackets>.
 * Every command here works with Git 2.23+ (switch/restore) unless noted.
 */

export type RecipeGroup =
  | 'Setup'
  | 'Everyday'
  | 'Undo & fix'
  | 'Branches'
  | 'Remotes'
  | 'Merge & rebase'
  | 'Stash'
  | 'History'
  | 'Tags'
  | 'Clean up'
  | 'Advanced';

export interface RecipeCommand {
  cmd: string;
  note?: string;
}

export interface GitRecipe {
  id: string;
  title: string;
  group: RecipeGroup;
  commands: RecipeCommand[];
  explain: string;
  keywords: string[];
  /** Shown as a warning: the command rewrites history or discards work. */
  danger?: string;
}

export const RECIPE_GROUPS: RecipeGroup[] = [
  'Setup',
  'Everyday',
  'Undo & fix',
  'Branches',
  'Remotes',
  'Merge & rebase',
  'Stash',
  'History',
  'Tags',
  'Clean up',
  'Advanced',
];

const REWRITE = 'Rewrites history. Only do this on commits you have not pushed, or coordinate a force push with your team.';

export const GIT_RECIPES: GitRecipe[] = [
  // ---- Setup ---------------------------------------------------------------
  {
    id: 'set-identity',
    title: 'Set your name and email',
    group: 'Setup',
    commands: [
      { cmd: 'git config --global user.name "<Your Name>"' },
      { cmd: 'git config --global user.email "<you@example.com>"' },
      { cmd: 'git config user.email "<work@example.com>"', note: 'Only for the current repository' },
    ],
    explain: 'Git records this identity in every commit you make. --global applies to all repositories of your user account.',
    keywords: ['config', 'username', 'author', 'identity', 'email'],
  },
  {
    id: 'default-branch',
    title: 'Use "main" as the default branch for new repositories',
    group: 'Setup',
    commands: [{ cmd: 'git config --global init.defaultBranch main' }],
    explain: 'Affects future `git init` calls. Existing repositories keep their branch names.',
    keywords: ['init', 'master', 'main', 'default branch'],
  },
  {
    id: 'init',
    title: 'Start a new repository',
    group: 'Setup',
    commands: [
      { cmd: 'git init' },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "Initial commit"' },
    ],
    explain: 'Creates a .git directory in the current folder, stages everything and records the first commit.',
    keywords: ['init', 'create', 'new repo', 'initialize'],
  },
  {
    id: 'clone',
    title: 'Clone a repository',
    group: 'Setup',
    commands: [
      { cmd: 'git clone <url>' },
      { cmd: 'git clone <url> <folder>', note: 'Into a folder with a different name' },
      { cmd: 'git clone --depth 1 <url>', note: 'Shallow clone: only the latest commit' },
      { cmd: 'git clone --branch <branch> <url>', note: 'Check out a specific branch' },
    ],
    explain: 'Downloads the repository with its history and sets up "origin" as the remote.',
    keywords: ['clone', 'download', 'copy', 'shallow', 'checkout'],
  },
  {
    id: 'aliases',
    title: 'Create command aliases',
    group: 'Setup',
    commands: [
      { cmd: 'git config --global alias.st status' },
      { cmd: 'git config --global alias.lg "log --oneline --graph --decorate --all"' },
    ],
    explain: 'After this, `git st` runs `git status` and `git lg` shows a compact history graph.',
    keywords: ['alias', 'shortcut', 'config'],
  },
  {
    id: 'line-endings',
    title: 'Handle Windows/Unix line endings',
    group: 'Setup',
    commands: [
      { cmd: 'git config --global core.autocrlf true', note: 'Windows: check out CRLF, commit LF' },
      { cmd: 'git config --global core.autocrlf input', note: 'macOS/Linux: convert CRLF to LF on commit' },
    ],
    explain: 'A `.gitattributes` file with `* text=auto` makes the behaviour consistent for everyone in the project.',
    keywords: ['crlf', 'lf', 'autocrlf', 'line endings', 'windows', 'gitattributes'],
  },

  // ---- Everyday ------------------------------------------------------------
  {
    id: 'status',
    title: 'See what changed',
    group: 'Everyday',
    commands: [
      { cmd: 'git status' },
      { cmd: 'git status -s', note: 'Short format' },
      { cmd: 'git diff', note: 'Unstaged changes' },
      { cmd: 'git diff --staged', note: 'Changes that will be committed' },
    ],
    explain: '`git diff` compares the working tree with the index; `--staged` compares the index with the last commit.',
    keywords: ['status', 'diff', 'changes', 'modified', 'staged'],
  },
  {
    id: 'stage-commit',
    title: 'Stage and commit changes',
    group: 'Everyday',
    commands: [
      { cmd: 'git add <file>' },
      { cmd: 'git add -p', note: 'Pick individual hunks interactively' },
      { cmd: 'git commit -m "<message>"' },
      { cmd: 'git commit -am "<message>"', note: 'Stage all tracked files and commit (new files are not included)' },
    ],
    explain: 'Changes go from the working tree to the index (staging area) with `git add`, then into history with `git commit`.',
    keywords: ['add', 'commit', 'stage', 'save', 'patch'],
  },
  {
    id: 'pull-push',
    title: 'Get and send changes',
    group: 'Everyday',
    commands: [
      { cmd: 'git pull', note: 'Fetch and integrate the upstream branch' },
      { cmd: 'git pull --rebase', note: 'Replay your local commits on top instead of merging' },
      { cmd: 'git push' },
      { cmd: 'git push -u origin <branch>', note: 'First push of a new branch: sets upstream' },
    ],
    explain: 'After `-u` (set upstream) plain `git pull` and `git push` know which remote branch to use.',
    keywords: ['pull', 'push', 'sync', 'upload', 'upstream', 'fetch'],
  },
  {
    id: 'rm-mv',
    title: 'Delete or rename a tracked file',
    group: 'Everyday',
    commands: [
      { cmd: 'git rm <file>' },
      { cmd: 'git rm --cached <file>', note: 'Stop tracking but keep the file on disk' },
      { cmd: 'git mv <old> <new>' },
    ],
    explain: '`--cached` is how you untrack a file that should have been in .gitignore.',
    keywords: ['remove', 'delete', 'rename', 'move', 'untrack', 'gitignore'],
  },

  // ---- Undo & fix ------------------------------------------------------------
  {
    id: 'amend',
    title: 'Fix the last commit message or add a forgotten file',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git commit --amend -m "<new message>"' },
      { cmd: 'git add <forgotten-file>' },
      { cmd: 'git commit --amend --no-edit', note: 'Keep the message, add the staged changes' },
    ],
    explain: 'Amending replaces the last commit with a new one.',
    keywords: ['amend', 'edit commit', 'change message', 'typo', 'forgot file'],
    danger: REWRITE,
  },
  {
    id: 'undo-last-commit-keep',
    title: 'Undo the last commit, keep the changes',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git reset --soft HEAD~1', note: 'Changes stay staged' },
      { cmd: 'git reset HEAD~1', note: 'Changes stay in the working tree, unstaged' },
    ],
    explain: 'Moves the branch back one commit. Nothing in your files is lost.',
    keywords: ['undo commit', 'uncommit', 'reset', 'soft', 'last commit', 'revert local'],
    danger: REWRITE,
  },
  {
    id: 'undo-last-commit-discard',
    title: 'Throw away the last commit and its changes',
    group: 'Undo & fix',
    commands: [{ cmd: 'git reset --hard HEAD~1' }],
    explain: 'The commit and all uncommitted changes are discarded. `git reflog` can still find the commit for a while.',
    keywords: ['reset hard', 'discard commit', 'delete commit', 'undo commit'],
    danger: 'Discards uncommitted work permanently and rewrites history.',
  },
  {
    id: 'revert',
    title: 'Undo a pushed commit safely',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git revert <commit>' },
      { cmd: 'git revert -m 1 <merge-commit>', note: 'Revert a merge, keeping the first parent' },
    ],
    explain: 'Creates a new commit that applies the inverse change. History is not rewritten, so it is safe on shared branches.',
    keywords: ['revert', 'undo pushed', 'rollback', 'inverse'],
  },
  {
    id: 'discard-file',
    title: 'Discard local changes to a file',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git restore <file>' },
      { cmd: 'git restore .', note: 'All files in the current directory' },
      { cmd: 'git checkout -- <file>', note: 'Older Git versions' },
    ],
    explain: 'Restores the file from the index, dropping edits that were not staged.',
    keywords: ['discard', 'restore', 'checkout', 'revert file', 'undo changes'],
    danger: 'Uncommitted edits to these files are lost.',
  },
  {
    id: 'unstage',
    title: 'Unstage a file',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git restore --staged <file>' },
      { cmd: 'git reset HEAD <file>', note: 'Older Git versions' },
    ],
    explain: 'Removes the file from the index but keeps your edits in the working tree.',
    keywords: ['unstage', 'reset', 'remove from index', 'undo add'],
  },
  {
    id: 'restore-from-commit',
    title: 'Get a file back from an earlier commit',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git restore --source <commit> <file>' },
      { cmd: 'git show <commit>:<path/to/file>', note: 'Just print it' },
    ],
    explain: 'Use `<commit>~1` to get the version from just before a commit that deleted or broke the file.',
    keywords: ['old version', 'recover file', 'restore', 'deleted file', 'show'],
  },
  {
    id: 'reflog',
    title: 'Recover a lost commit or branch',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git reflog' },
      { cmd: 'git branch <rescue-branch> <commit>' },
    ],
    explain: 'The reflog lists every position HEAD has had, including commits dropped by reset or rebase. Entries expire after about 90 days.',
    keywords: ['reflog', 'recover', 'lost commit', 'undo reset', 'undo rebase', 'deleted branch'],
  },
  {
    id: 'reset-to-remote',
    title: 'Make a local branch match the remote exactly',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git fetch origin' },
      { cmd: 'git reset --hard origin/<branch>' },
    ],
    explain: 'Discards local commits and changes on this branch and points it at the remote version.',
    keywords: ['reset', 'match remote', 'sync', 'discard local', 'hard reset'],
    danger: 'Local commits and uncommitted changes on this branch are discarded.',
  },
  {
    id: 'wrong-branch',
    title: 'Move commits made on the wrong branch',
    group: 'Undo & fix',
    commands: [
      { cmd: 'git branch <new-branch>', note: 'Keep the commits on a new branch' },
      { cmd: 'git reset --hard HEAD~<n>', note: 'Remove the last n commits from the current branch' },
      { cmd: 'git switch <new-branch>' },
    ],
    explain: 'The new branch keeps the commits; the current branch goes back n commits. Commit or stash any uncommitted work first.',
    keywords: ['wrong branch', 'move commits', 'committed to main', 'oops'],
    danger: REWRITE,
  },

  // ---- Branches --------------------------------------------------------------
  {
    id: 'create-branch',
    title: 'Create and switch to a branch',
    group: 'Branches',
    commands: [
      { cmd: 'git switch -c <branch>' },
      { cmd: 'git switch -c <branch> <start-point>', note: 'Start from another branch, tag or commit' },
      { cmd: 'git checkout -b <branch>', note: 'Older Git versions' },
    ],
    explain: 'The new branch starts at the current commit unless you give a start point.',
    keywords: ['branch', 'new branch', 'create', 'switch', 'checkout'],
  },
  {
    id: 'switch-branch',
    title: 'Switch branches',
    group: 'Branches',
    commands: [
      { cmd: 'git switch <branch>' },
      { cmd: 'git switch -', note: 'Back to the previous branch' },
      { cmd: 'git switch <remote-branch-name>', note: 'Creates a local tracking branch if origin/<name> exists' },
    ],
    explain: 'Uncommitted changes are carried over if they do not conflict; otherwise Git refuses and asks you to commit or stash.',
    keywords: ['switch', 'checkout', 'change branch', 'go to branch'],
  },
  {
    id: 'list-branches',
    title: 'List branches',
    group: 'Branches',
    commands: [
      { cmd: 'git branch', note: 'Local' },
      { cmd: 'git branch -a', note: 'Local and remote-tracking' },
      { cmd: 'git branch -vv', note: 'With upstream and ahead/behind counts' },
      { cmd: 'git branch --merged', note: 'Already merged into the current branch' },
    ],
    explain: 'Remote-tracking branches such as origin/main update when you fetch.',
    keywords: ['list', 'branches', 'show branches', 'merged'],
  },
  {
    id: 'rename-branch',
    title: 'Rename a branch',
    group: 'Branches',
    commands: [
      { cmd: 'git branch -m <new-name>', note: 'Rename the current branch' },
      { cmd: 'git branch -m <old-name> <new-name>' },
      { cmd: 'git push origin -u <new-name>', note: 'Publish the new name' },
      { cmd: 'git push origin --delete <old-name>', note: 'Remove the old name from the remote' },
    ],
    explain: 'Renaming is local; push the new branch and delete the old one to rename it on the remote.',
    keywords: ['rename', 'move branch', 'branch name'],
  },
  {
    id: 'delete-branch',
    title: 'Delete a branch',
    group: 'Branches',
    commands: [
      { cmd: 'git branch -d <branch>', note: 'Only if merged' },
      { cmd: 'git branch -D <branch>', note: 'Force, even if unmerged' },
      { cmd: 'git push origin --delete <branch>', note: 'Delete on the remote' },
    ],
    explain: '`-d` refuses to delete a branch whose commits are not merged anywhere, which protects you from losing work.',
    keywords: ['delete branch', 'remove branch', 'prune'],
  },
  {
    id: 'set-upstream',
    title: 'Track a remote branch',
    group: 'Branches',
    commands: [{ cmd: 'git branch -u origin/<branch>' }, { cmd: 'git push -u origin <branch>' }],
    explain: 'Sets the upstream so `git status` shows ahead/behind and `git pull` / `git push` need no arguments.',
    keywords: ['upstream', 'track', 'set-upstream-to', 'tracking'],
  },

  // ---- Remotes ---------------------------------------------------------------
  {
    id: 'remotes',
    title: 'View and change remotes',
    group: 'Remotes',
    commands: [
      { cmd: 'git remote -v' },
      { cmd: 'git remote add <name> <url>' },
      { cmd: 'git remote set-url origin <new-url>', note: 'e.g. switch from HTTPS to SSH' },
      { cmd: 'git remote remove <name>' },
    ],
    explain: 'A remote is a named URL. "origin" is the default name for the repository you cloned from.',
    keywords: ['remote', 'origin', 'url', 'set-url', 'ssh', 'https'],
  },
  {
    id: 'fetch',
    title: 'Download without merging',
    group: 'Remotes',
    commands: [{ cmd: 'git fetch' }, { cmd: 'git fetch --all --prune', note: 'All remotes, drop deleted remote branches' }],
    explain: 'Updates remote-tracking branches (origin/*) but leaves your branches and files unchanged.',
    keywords: ['fetch', 'download', 'update', 'prune'],
  },
  {
    id: 'sync-fork',
    title: 'Update a fork from the original repository',
    group: 'Remotes',
    commands: [
      { cmd: 'git remote add upstream <original-url>' },
      { cmd: 'git fetch upstream' },
      { cmd: 'git switch main' },
      { cmd: 'git merge upstream/main' },
      { cmd: 'git push origin main' },
    ],
    explain: 'The "upstream" remote points at the original project; you only need to add it once.',
    keywords: ['fork', 'upstream', 'sync fork', 'update fork'],
  },
  {
    id: 'force-push',
    title: 'Force push safely',
    group: 'Remotes',
    commands: [{ cmd: 'git push --force-with-lease' }],
    explain: 'Unlike --force, this refuses to overwrite the remote branch if someone else pushed commits you have not fetched.',
    keywords: ['force push', 'push -f', 'lease', 'overwrite'],
    danger: 'Replaces the remote branch history.',
  },

  // ---- Merge & rebase ---------------------------------------------------------
  {
    id: 'merge',
    title: 'Merge a branch into the current one',
    group: 'Merge & rebase',
    commands: [
      { cmd: 'git merge <branch>' },
      { cmd: 'git merge --no-ff <branch>', note: 'Always create a merge commit' },
      { cmd: 'git merge --squash <branch>', note: 'Stage all changes as one commit (then git commit)' },
    ],
    explain: 'If the current branch has no new commits, Git just moves it forward (fast-forward) unless you use --no-ff.',
    keywords: ['merge', 'combine', 'squash', 'fast-forward'],
  },
  {
    id: 'conflicts',
    title: 'Resolve merge conflicts',
    group: 'Merge & rebase',
    commands: [
      { cmd: 'git status', note: 'Lists the conflicted files' },
      { cmd: 'git add <resolved-file>', note: 'After editing out the <<<<<<< ======= >>>>>>> markers' },
      { cmd: 'git merge --continue', note: 'Or: git rebase --continue' },
      { cmd: 'git merge --abort', note: 'Give up and return to the state before the merge' },
    ],
    explain: '`git checkout --ours <file>` or `--theirs <file>` takes one side entirely.',
    keywords: ['conflict', 'resolve', 'merge conflict', 'abort', 'ours', 'theirs'],
  },
  {
    id: 'rebase',
    title: 'Rebase a branch onto main',
    group: 'Merge & rebase',
    commands: [
      { cmd: 'git fetch origin' },
      { cmd: 'git rebase origin/main' },
      { cmd: 'git rebase --abort', note: 'Undo a rebase in progress' },
    ],
    explain: 'Replays your commits on top of the latest main, giving a linear history.',
    keywords: ['rebase', 'update branch', 'linear history', 'onto'],
    danger: REWRITE,
  },
  {
    id: 'squash',
    title: 'Squash the last few commits into one',
    group: 'Merge & rebase',
    commands: [
      { cmd: 'git rebase -i HEAD~<n>', note: 'Change "pick" to "squash" (or "s") for commits to fold in' },
      { cmd: 'git reset --soft HEAD~<n> && git commit', note: 'Non-interactive alternative' },
    ],
    explain: 'Interactive rebase also lets you reorder, reword (r), edit (e) or drop (d) commits.',
    keywords: ['squash', 'combine commits', 'interactive rebase', 'fixup', 'reword'],
    danger: REWRITE,
  },
  {
    id: 'cherry-pick',
    title: 'Copy a commit from another branch',
    group: 'Merge & rebase',
    commands: [
      { cmd: 'git cherry-pick <commit>' },
      { cmd: 'git cherry-pick <first>^..<last>', note: 'A range, inclusive' },
      { cmd: 'git cherry-pick --abort' },
    ],
    explain: 'Applies the changes of the given commit(s) as new commits on the current branch.',
    keywords: ['cherry-pick', 'copy commit', 'apply commit', 'backport'],
  },
  {
    id: 'fixup',
    title: 'Fix an older commit with autosquash',
    group: 'Merge & rebase',
    commands: [
      { cmd: 'git commit --fixup <commit>' },
      { cmd: 'git rebase -i --autosquash <commit>~1' },
    ],
    explain: 'The fixup commit is automatically moved next to its target and folded into it during the rebase.',
    keywords: ['fixup', 'autosquash', 'fix older commit', 'amend old commit'],
    danger: REWRITE,
  },

  // ---- Stash -----------------------------------------------------------------
  {
    id: 'stash',
    title: 'Put work aside temporarily',
    group: 'Stash',
    commands: [
      { cmd: 'git stash push -m "<message>"' },
      { cmd: 'git stash -u', note: 'Include untracked files' },
      { cmd: 'git stash list' },
      { cmd: 'git stash pop', note: 'Re-apply the latest stash and remove it' },
      { cmd: 'git stash apply stash@{<n>}', note: 'Re-apply a specific stash and keep it' },
    ],
    explain: 'Stashing saves uncommitted changes and cleans the working tree so you can switch branches.',
    keywords: ['stash', 'save for later', 'shelve', 'pop', 'apply'],
  },
  {
    id: 'stash-drop',
    title: 'Delete stashes',
    group: 'Stash',
    commands: [{ cmd: 'git stash drop stash@{<n>}' }, { cmd: 'git stash clear', note: 'All stashes' }],
    explain: 'Dropped stashes are hard to recover; check `git stash show -p stash@{<n>}` first.',
    keywords: ['stash drop', 'stash clear', 'delete stash'],
    danger: 'Dropped stashes are effectively lost.',
  },
  {
    id: 'stash-branch',
    title: 'Turn a stash into a branch',
    group: 'Stash',
    commands: [{ cmd: 'git stash branch <new-branch> stash@{<n>}' }],
    explain: 'Creates a branch at the commit where the stash was made and applies it there, avoiding conflicts.',
    keywords: ['stash branch', 'stash to branch'],
  },

  // ---- History ------------------------------------------------------------------
  {
    id: 'log',
    title: 'View commit history',
    group: 'History',
    commands: [
      { cmd: 'git log --oneline --graph --decorate --all' },
      { cmd: 'git log -p <file>', note: 'History of one file with diffs' },
      { cmd: 'git log --follow <file>', note: 'Continue through renames' },
      { cmd: 'git log --author="<name>" --since="2 weeks ago"' },
    ],
    explain: 'Combine filters freely: --grep="<text>" searches messages, -n 10 limits the count.',
    keywords: ['log', 'history', 'commits', 'graph', 'author'],
  },
  {
    id: 'blame',
    title: 'Find who changed a line',
    group: 'History',
    commands: [
      { cmd: 'git blame <file>' },
      { cmd: 'git blame -L 10,20 <file>', note: 'Only lines 10 to 20' },
    ],
    explain: 'Shows the last commit, author and date for every line.',
    keywords: ['blame', 'annotate', 'who changed', 'author of line'],
  },
  {
    id: 'search-code',
    title: 'Find when code was added or removed',
    group: 'History',
    commands: [
      { cmd: 'git log -S "<text>"', note: 'Commits that change the number of occurrences' },
      { cmd: 'git log -G "<regex>"', note: 'Commits whose diff matches a regex' },
      { cmd: 'git grep "<text>"', note: 'Search the current files' },
    ],
    explain: 'The "pickaxe" (-S) is the fastest way to find the commit that introduced or deleted a function.',
    keywords: ['search', 'pickaxe', 'grep', 'find code', 'when was'],
  },
  {
    id: 'show',
    title: 'Inspect a commit',
    group: 'History',
    commands: [{ cmd: 'git show <commit>' }, { cmd: 'git show --stat <commit>', note: 'Only the changed files' }],
    explain: 'Shows the commit metadata and its diff.',
    keywords: ['show', 'inspect', 'commit details'],
  },
  {
    id: 'compare-branches',
    title: 'Compare two branches',
    group: 'History',
    commands: [
      { cmd: 'git diff main...<branch>', note: 'Changes on the branch since it forked' },
      { cmd: 'git log main..<branch>', note: 'Commits on the branch that main does not have' },
      { cmd: 'git diff --stat main <branch>' },
    ],
    explain: 'Three dots in `git diff` compare with the merge base; two dots in `git log` mean "reachable from the right but not the left".',
    keywords: ['compare', 'diff branches', 'difference', 'ahead', 'behind'],
  },
  {
    id: 'bisect',
    title: 'Find the commit that introduced a bug',
    group: 'History',
    commands: [
      { cmd: 'git bisect start' },
      { cmd: 'git bisect bad', note: 'The current commit is broken' },
      { cmd: 'git bisect good <commit>', note: 'A known good commit' },
      { cmd: 'git bisect reset', note: 'When done' },
    ],
    explain: 'Git checks out the midpoint; mark each one good or bad until the first bad commit is found. `git bisect run <script>` automates it.',
    keywords: ['bisect', 'find bug', 'regression', 'binary search'],
  },

  // ---- Tags ---------------------------------------------------------------------
  {
    id: 'tags',
    title: 'Create and push tags',
    group: 'Tags',
    commands: [
      { cmd: 'git tag -a <tag> -m "<message>"', note: 'Annotated tag (recommended for releases)' },
      { cmd: 'git tag <tag> <commit>', note: 'Lightweight tag on a specific commit' },
      { cmd: 'git push origin <tag>' },
      { cmd: 'git push --tags', note: 'All tags' },
    ],
    explain: 'Tags are not pushed by `git push` alone.',
    keywords: ['tag', 'release', 'version', 'annotated'],
  },
  {
    id: 'delete-tag',
    title: 'Delete a tag',
    group: 'Tags',
    commands: [{ cmd: 'git tag -d <tag>' }, { cmd: 'git push origin --delete <tag>' }],
    explain: 'Delete locally and on the remote separately.',
    keywords: ['delete tag', 'remove tag'],
  },

  // ---- Clean up -------------------------------------------------------------------
  {
    id: 'clean',
    title: 'Remove untracked files',
    group: 'Clean up',
    commands: [
      { cmd: 'git clean -n', note: 'Dry run: list what would be deleted' },
      { cmd: 'git clean -fd', note: 'Delete untracked files and directories' },
      { cmd: 'git clean -fdx', note: 'Also delete ignored files (build output, node_modules)' },
    ],
    explain: 'Always run the dry run first.',
    keywords: ['clean', 'untracked', 'delete files', 'remove build'],
    danger: 'Deleted untracked files cannot be recovered with Git.',
  },
  {
    id: 'apply-gitignore',
    title: 'Apply a new .gitignore to already tracked files',
    group: 'Clean up',
    commands: [
      { cmd: 'git rm -r --cached .' },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "chore: apply .gitignore"' },
    ],
    explain: 'Untracks everything and re-adds it, so files now matched by .gitignore drop out of the repository (they stay on disk).',
    keywords: ['gitignore', 'untrack', 'ignored files still tracked', 'cached'],
  },
  {
    id: 'prune-branches',
    title: 'Delete local branches that are merged',
    group: 'Clean up',
    commands: [
      { cmd: 'git fetch --prune' },
      { cmd: 'git branch --merged main', note: 'Review the list first' },
      { cmd: 'git branch -d <branch>' },
    ],
    explain: '`--prune` removes remote-tracking branches whose remote branch was deleted.',
    keywords: ['prune', 'cleanup branches', 'merged', 'stale'],
  },
  {
    id: 'gc',
    title: 'Check repository size and compact it',
    group: 'Clean up',
    commands: [{ cmd: 'git count-objects -vH' }, { cmd: 'git gc' }],
    explain: '`git gc` packs loose objects and removes unreachable ones that have expired.',
    keywords: ['gc', 'garbage collection', 'size', 'compact', 'optimize'],
  },

  // ---- Advanced ----------------------------------------------------------------------
  {
    id: 'worktree',
    title: 'Work on two branches at once',
    group: 'Advanced',
    commands: [
      { cmd: 'git worktree add ../<folder> <branch>' },
      { cmd: 'git worktree list' },
      { cmd: 'git worktree remove ../<folder>' },
    ],
    explain: 'A worktree is a second working directory sharing the same repository; no need to stash to review another branch.',
    keywords: ['worktree', 'multiple branches', 'parallel'],
  },
  {
    id: 'submodules',
    title: 'Clone or update submodules',
    group: 'Advanced',
    commands: [
      { cmd: 'git clone --recurse-submodules <url>' },
      { cmd: 'git submodule update --init --recursive', note: 'After a normal clone' },
      { cmd: 'git submodule add <url> <path>' },
    ],
    explain: 'Submodules pin another repository at a specific commit inside yours.',
    keywords: ['submodule', 'nested repo', 'recursive'],
  },
  {
    id: 'patches',
    title: 'Create and apply patch files',
    group: 'Advanced',
    commands: [
      { cmd: 'git format-patch -1 <commit>', note: 'One .patch file per commit, with author and message' },
      { cmd: 'git am <file.patch>', note: 'Apply as commits' },
      { cmd: 'git diff > changes.diff' },
      { cmd: 'git apply --check changes.diff', note: 'Test first' },
      { cmd: 'git apply changes.diff' },
    ],
    explain: '`git apply` changes files only; `git am` also creates commits from format-patch mail files.',
    keywords: ['patch', 'format-patch', 'am', 'apply', 'diff file'],
  },
  {
    id: 'sparse',
    title: 'Check out only part of a big repository',
    group: 'Advanced',
    commands: [
      { cmd: 'git clone --filter=blob:none --sparse <url>' },
      { cmd: 'git sparse-checkout set <dir1> <dir2>' },
    ],
    explain: 'Partial clone downloads file contents on demand; sparse checkout limits which directories appear on disk.',
    keywords: ['sparse checkout', 'partial clone', 'monorepo', 'large repo'],
  },
  {
    id: 'lfs',
    title: 'Track large files with Git LFS',
    group: 'Advanced',
    commands: [
      { cmd: 'git lfs install', note: 'Once per machine (requires the git-lfs extension)' },
      { cmd: 'git lfs track "*.psd"' },
      { cmd: 'git add .gitattributes' },
    ],
    explain: 'LFS stores large binaries outside the normal object database and downloads them on checkout.',
    keywords: ['lfs', 'large files', 'binary', 'big files'],
  },
  {
    id: 'remove-secret',
    title: 'Remove a committed secret from history',
    group: 'Advanced',
    commands: [
      { cmd: 'git filter-repo --invert-paths --path <file>', note: 'Requires the git-filter-repo tool' },
      { cmd: 'git push --force-with-lease --all' },
    ],
    explain: 'Rotate the leaked secret first: it may already be copied. Then rewrite history and ask collaborators to re-clone.',
    keywords: ['secret', 'password', 'api key', 'filter-repo', 'bfg', 'remove file from history', 'leak'],
    danger: 'Rewrites the whole history of the repository.',
  },
];

/** Case-insensitive search: every word of the query must appear in the title, commands, explanation or keywords. */
export function searchRecipes(query: string, recipes: GitRecipe[] = GIT_RECIPES): GitRecipe[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return recipes;
  return recipes
    .map((r) => {
      const title = r.title.toLowerCase();
      const hay = [title, r.explain, r.group, ...r.keywords, ...r.commands.flatMap((c) => [c.cmd, c.note ?? ''])].join('\n').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (r.keywords.some((k) => k.includes(w)) ? 2 : 0), 0);
      return { r, score };
    })
    .filter((x): x is { r: GitRecipe; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}
