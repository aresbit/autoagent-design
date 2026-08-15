export const REDO_TOOL_NAME = 'redotool'

export const DESCRIPTION = `
RedoTool replays and teaches a repository's early commit history.

Workflow:
1) Resolve repo source (localRepoPath or cloned repo)
2) Optional safety copy to /tmp workspace (default enabled)
3) Replay selected first commit (from chosen range/list) into redo-<repoName>/0001-<hash>/
4) Analyze commit history in adaptive batches
5) Generate markdown lectures under redo-lec/ for GitHub Pages publishing

Grouping behavior:
- auto (default): dense commit => one lecture, sparse commits => grouped (up to 5)
- one_per_commit: strict one hash per lecture
- fixed: exactly batchSize commits per lecture

Commit selection:
- targetHashes: explicit hash/prefix list (highest priority)
- startFromHash/endAtHash: inclusive range selection
- if none provided: full history

Safety:
- useTempWorkspace=true (default) prevents polluting current directory
- cloneIfMissing can be disabled when repo already exists locally
`

export function getPrompt(): string {
  return DESCRIPTION
}
