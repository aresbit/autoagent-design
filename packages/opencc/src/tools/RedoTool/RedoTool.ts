import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import path, { join, resolve } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { DESCRIPTION, getPrompt, REDO_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    repoUrl: z.string().url().describe('Git repository URL, e.g. https://github.com/aresbit/QUANTAXIS'),
    groupingMode: z
      .enum(['auto', 'one_per_commit', 'fixed'])
      .default('auto')
      .describe('auto: dense commit solo, sparse commits grouped; one_per_commit: strict 1:1; fixed: use batchSize'),
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5)
      .describe('Commits per lecture when groupingMode=fixed'),
    maxLectures: z.number().int().min(1).max(200).default(30).describe('Maximum lectures to generate'),
    localRepoPath: z
      .string()
      .optional()
      .describe('Optional existing local repository path. If provided, clone step is skipped.'),
    cloneIfMissing: z
      .boolean()
      .default(true)
      .describe('When no local repo exists, whether to clone from repoUrl.'),
    useTempWorkspace: z
      .boolean()
      .default(true)
      .describe('When true, operate in /tmp workspace to avoid polluting current directory.'),
    startFromHash: z
      .string()
      .optional()
      .describe('Optional commit hash/prefix to start from (inclusive).'),
    endAtHash: z
      .string()
      .optional()
      .describe('Optional commit hash/prefix to end at (inclusive).'),
    targetHashes: z
      .array(z.string())
      .optional()
      .describe('Optional explicit commit hash/prefix list to process; overrides startFromHash/endAtHash'),
    cloneDir: z.string().optional().describe('Base directory for clone, default current working directory'),
    redoDirName: z.string().optional().describe('Redo replay dir name, default redo-<repoName>'),
    lectureDirName: z.string().default('redo-lec').describe('Lecture output directory name'),
    forceRefresh: z.boolean().default(false).describe('If true and repo exists, run fetch/pull before analysis'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    repoName: z.string(),
    sourceRepoPath: z.string(),
    repoPath: z.string(),
    redoPath: z.string(),
    lecturePath: z.string(),
    firstCommit: z.string().optional(),
    totalCommits: z.number().int(),
    selectedCommits: z.number().int(),
    selectedStartCommit: z.string().optional(),
    selectedEndCommit: z.string().optional(),
    lectureFiles: z.array(z.string()),
    message: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

type CommitInfo = {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

type CommitStats = {
  files: number
  insertions: number
  deletions: number
}

function repoNameFromUrl(repoUrl: string): string {
  const clean = repoUrl.replace(/\.git$/i, '').replace(/\/$/, '')
  const seg = clean.split('/').filter(Boolean).pop()
  if (!seg) return 'repo'
  return seg.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function runCommand(
  command: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    signal,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `Command failed: ${command.join(' ')}`)
  }

  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function splitIntoBatches<T>(items: T[], size: number, maxBatches: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    if (out.length >= maxBatches) break
    out.push(items.slice(i, i + size))
  }
  return out
}

function parseNumStat(stdout: string): CommitStats {
  let files = 0
  let insertions = 0
  let deletions = 0

  for (const line of stdout.split('\n').map(v => v.trim()).filter(Boolean)) {
    const [addRaw, delRaw] = line.split('\t')
    const add = Number.parseInt(addRaw || '0', 10)
    const del = Number.parseInt(delRaw || '0', 10)
    files += 1
    if (Number.isFinite(add)) insertions += add
    if (Number.isFinite(del)) deletions += del
  }

  return { files, insertions, deletions }
}

function commitComplexityScore(stats: CommitStats): number {
  return stats.files * 2 + stats.insertions * 0.08 + stats.deletions * 0.06
}

function buildAutoBatches(
  commits: CommitInfo[],
  statsMap: Map<string, CommitStats>,
  maxBatches: number,
): CommitInfo[][] {
  const out: CommitInfo[][] = []
  const targetScore = 22
  const hardMaxPerBatch = 5
  let i = 0

  while (i < commits.length && out.length < maxBatches) {
    const batch: CommitInfo[] = []
    let accScore = 0

    while (i < commits.length && batch.length < hardMaxPerBatch) {
      const commit = commits[i] as CommitInfo
      const stats = statsMap.get(commit.hash) || { files: 1, insertions: 0, deletions: 0 }
      const score = commitComplexityScore(stats)

      if (score >= targetScore) {
        if (batch.length === 0) {
          batch.push(commit)
          i += 1
        }
        break
      }

      batch.push(commit)
      accScore += score
      i += 1

      if (accScore >= targetScore) break
    }

    if (batch.length === 0 && i < commits.length) {
      batch.push(commits[i] as CommitInfo)
      i += 1
    }

    out.push(batch)
  }

  return out
}

function findCommitByPrefix(commits: CommitInfo[], prefix: string): CommitInfo | null {
  const p = prefix.trim()
  if (!p) return null
  const matches = commits.filter(
    c => c.hash.startsWith(p) || c.shortHash.startsWith(p),
  )
  if (matches.length !== 1) return null
  return matches[0] as CommitInfo
}

function inferDomainKnowledge(repoName: string, changedFiles: string[], readmeText: string): string[] {
  const text = `${repoName}\n${changedFiles.join('\n')}\n${readmeText}`.toLowerCase()
  const points: string[] = []

  if (text.includes('quant') || text.includes('trade') || text.includes('finance') || text.includes('strategy')) {
    points.push('项目涉及量化交易/金融分析，提交可能围绕数据、策略与回测能力演进。')
  }
  if (text.includes('backtest') || text.includes('回测')) {
    points.push('出现回测语义，需关注策略输入、交易撮合和绩效指标一致性。')
  }
  if (text.includes('data') || text.includes('dataset') || text.includes('csv')) {
    points.push('数据处理是核心领域能力，重点包括数据清洗、时间对齐与缺失值处理。')
  }
  if (text.includes('api') || text.includes('client') || text.includes('http')) {
    points.push('含接口/客户端改动，领域上关注外部数据源稳定性与调用限流。')
  }
  if (points.length === 0) {
    points.push('该批提交更偏通用工程演进，领域语义较弱，建议结合后续业务提交解读。')
  }

  return points
}

function inferCodingKnowledge(changedFiles: string[]): string[] {
  const exts = new Set(changedFiles.map(f => path.extname(f).toLowerCase()))
  const points: string[] = []

  if (exts.has('.py')) points.push('Python 代码演进：关注模块边界、函数纯度和异常路径处理。')
  if (exts.has('.ts') || exts.has('.tsx') || exts.has('.js')) points.push('JS/TS 代码演进：关注类型契约、异步流程与边界校验。')
  if (exts.has('.md')) points.push('文档随代码演进，建议把 README 视作架构入口而非附属品。')
  if (changedFiles.some(f => /test|spec/i.test(f))) points.push('该批提交包含测试线索，可从测试反推设计意图与稳定性目标。')
  if (changedFiles.some(f => /config|yaml|yml|toml|json/i.test(f))) points.push('出现配置变更，关注默认值策略与部署环境一致性。')

  if (points.length === 0) {
    points.push('本批提交偏小，建议从命名、目录结构和 commit message 训练代码阅读能力。')
  }

  return points
}

function formatLecture(
  repoName: string,
  batchIndex: number,
  batch: CommitInfo[],
  changedFiles: string[],
  codingPoints: string[],
  domainPoints: string[],
): string {
  const first = batch[0]
  const last = batch[batch.length - 1]

  const timeline = batch
    .map(c => `- ${c.shortHash} (${c.date}) ${c.author}: ${c.subject}`)
    .join('\n')

  const files = changedFiles.length
    ? changedFiles.slice(0, 120).map(f => `- ${f}`).join('\n')
    : '- (no changed files parsed)'

  const coding = codingPoints.map(p => `- ${p}`).join('\n')
  const domain = domainPoints.map(p => `- ${p}`).join('\n')

  return `---
layout: default
title: "${repoName} Lecture ${String(batchIndex).padStart(3, '0')}"
---

# ${repoName} Lecture ${String(batchIndex).padStart(3, '0')}

## Commit Scope
- Start: ${first?.hash || 'N/A'}
- End: ${last?.hash || 'N/A'}
- Commit count: ${batch.length}

## Timeline
${timeline}

## Changed Files (sample)
${files}

## 编码知识（Coding Knowledge）
${coding}

## 领域知识（Domain Knowledge）
${domain}

## 阅读练习
1. 按时间顺序阅读本讲提交，标注“新增能力”和“重构行为”。
2. 为每个提交写一句“为什么现在要改这段代码”。
3. 将本讲输出总结为一张架构小图，作为下一讲的先验上下文。
`
}

async function aggregateChangedFiles(repoPath: string, commits: CommitInfo[], signal: AbortSignal): Promise<string[]> {
  const files = new Set<string>()

  for (const commit of commits) {
    const r = await runCommand(
      ['git', 'show', '--name-only', '--pretty=format:', commit.hash],
      repoPath,
      signal,
    )

    for (const line of r.stdout.split('\n').map(v => v.trim()).filter(Boolean)) {
      files.add(line)
    }
  }

  return [...files]
}

async function readmeSnippet(repoPath: string): Promise<string> {
  const candidates = ['README.md', 'README.MD', 'readme.md']
  for (const c of candidates) {
    const p = join(repoPath, c)
    if (await exists(p)) {
      const content = await readFile(p, 'utf-8')
      return content.slice(0, 6000)
    }
  }
  return ''
}

export const RedoTool = buildTool({
  name: REDO_TOOL_NAME,
  searchHint: 'clone repo replay selected commit and generate commit lectures in safe temp workspace',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get inputJSONSchema() {
    const schema = zodToJsonSchema(inputSchema())
    schema.type = 'object'
    return schema
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'RedoTool'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.repoUrl} mode=${input.groupingMode} batch=${input.batchSize} start=${input.startFromHash || ''} end=${input.endAtHash || ''} tmp=${input.useTempWorkspace}`
  },
  async call(input: Input, context) {
    const signal = context.abortController.signal
    const baseDir = resolve(input.cloneDir || process.cwd())
    const effectiveCloneIfMissing = input.cloneIfMissing ?? true
    const effectiveUseTempWorkspace = input.useTempWorkspace ?? true
    const effectiveLectureDirName = input.lectureDirName || 'redo-lec'
    const repoName = repoNameFromUrl(input.repoUrl)

    const candidateLocal = input.localRepoPath
      ? resolve(input.localRepoPath)
      : join(baseDir, repoName)

    let sourceRepoPath = candidateLocal
    if (!(await exists(sourceRepoPath))) {
      if (!effectiveCloneIfMissing) {
        return {
          data: {
            success: false,
            repoName,
            sourceRepoPath,
            repoPath: sourceRepoPath,
            redoPath: '',
            lecturePath: '',
            totalCommits: 0,
            selectedCommits: 0,
            lectureFiles: [],
            message: `Repository not found locally and cloneIfMissing=false: ${sourceRepoPath}`,
          },
        }
      }
      await runCommand(['git', 'clone', input.repoUrl, sourceRepoPath], baseDir, signal)
    } else if (input.forceRefresh) {
      await runCommand(['git', 'fetch', '--all', '--tags'], sourceRepoPath, signal)
      await runCommand(['git', 'pull', '--ff-only'], sourceRepoPath, signal)
    }

    let workspaceBaseDir = baseDir
    let repoPath = sourceRepoPath
    if (effectiveUseTempWorkspace) {
      workspaceBaseDir = await mkdtemp(join(tmpdir(), `redotool-${repoName}-`))
      const tempRepoPath = join(workspaceBaseDir, repoName)
      await cp(sourceRepoPath, tempRepoPath, { recursive: true })
      repoPath = tempRepoPath
    }

    const redoPath = join(workspaceBaseDir, input.redoDirName || `redo-${repoName}`)
    const lecturePath = join(workspaceBaseDir, effectiveLectureDirName)

    const revList = await runCommand(['git', 'rev-list', '--reverse', 'HEAD'], repoPath, signal)
    const hashes = revList.stdout.split('\n').map(v => v.trim()).filter(Boolean)

    if (!hashes.length) {
      return {
        data: {
          success: false,
          repoName,
          sourceRepoPath,
          repoPath,
          redoPath,
          lecturePath,
          totalCommits: 0,
          selectedCommits: 0,
          lectureFiles: [],
          message: 'No commits found in target repository.',
        },
      }
    }

    const logFormat = '%H%x09%h%x09%an%x09%ad%x09%s'
    const logRaw = await runCommand(
      ['git', 'log', '--reverse', `--format=${logFormat}`, '--date=short'],
      repoPath,
      signal,
    )

    const commits: CommitInfo[] = logRaw.stdout
      .split('\n')
      .map(v => v.trim())
      .filter(Boolean)
      .map(line => {
        const [hash, shortHash, author, date, ...subject] = line.split('\t')
        return {
          hash: hash || '',
          shortHash: shortHash || '',
          author: author || '',
          date: date || '',
          subject: subject.join('\t') || '',
        }
      })
      .filter(c => c.hash)

    let selectedCommitsList: CommitInfo[] = commits
    if (input.targetHashes && input.targetHashes.length > 0) {
      const picked: CommitInfo[] = []
      for (const raw of input.targetHashes) {
        const found = findCommitByPrefix(commits, raw)
        if (!found) {
          return {
            data: {
              success: false,
              repoName,
              sourceRepoPath,
              repoPath,
              redoPath,
              lecturePath,
              totalCommits: commits.length,
              selectedCommits: 0,
              lectureFiles: [],
              message: `target hash not found or ambiguous: ${raw}`,
            },
          }
        }
        picked.push(found)
      }
      selectedCommitsList = picked
    } else {
      let startIndex = 0
      let endIndex = commits.length - 1

      if (input.startFromHash) {
        const found = findCommitByPrefix(commits, input.startFromHash)
        if (!found) {
          return {
            data: {
              success: false,
              repoName,
              sourceRepoPath,
              repoPath,
              redoPath,
              lecturePath,
              totalCommits: commits.length,
              selectedCommits: 0,
              lectureFiles: [],
              message: `startFromHash not found or ambiguous: ${input.startFromHash}`,
            },
          }
        }
        startIndex = commits.findIndex(c => c.hash === found.hash)
      }

      if (input.endAtHash) {
        const found = findCommitByPrefix(commits, input.endAtHash)
        if (!found) {
          return {
            data: {
              success: false,
              repoName,
              sourceRepoPath,
              repoPath,
              redoPath,
              lecturePath,
              totalCommits: commits.length,
              selectedCommits: 0,
              lectureFiles: [],
              message: `endAtHash not found or ambiguous: ${input.endAtHash}`,
            },
          }
        }
        endIndex = commits.findIndex(c => c.hash === found.hash)
      }

      if (startIndex > endIndex) {
        return {
          data: {
            success: false,
            repoName,
            sourceRepoPath,
            repoPath,
            redoPath,
            lecturePath,
            totalCommits: commits.length,
            selectedCommits: 0,
            lectureFiles: [],
            message: 'Invalid range: startFromHash is after endAtHash.',
          },
        }
      }

      selectedCommitsList = commits.slice(startIndex, endIndex + 1)
    }

    if (!selectedCommitsList.length) {
      return {
        data: {
          success: false,
          repoName,
          sourceRepoPath,
          repoPath,
          redoPath,
          lecturePath,
          totalCommits: commits.length,
          selectedCommits: 0,
          lectureFiles: [],
          message: 'No commits selected after hash filtering.',
        },
      }
    }

    const replayCommit = selectedCommitsList[0] as CommitInfo
    const firstCommit = replayCommit.hash

    await mkdir(redoPath, { recursive: true })
    await mkdir(lecturePath, { recursive: true })

    const replayDir = join(redoPath, `0001-${firstCommit.slice(0, 8)}`)
    await mkdir(replayDir, { recursive: true })

    await runCommand(
      ['git', '--work-tree', replayDir, 'checkout', firstCommit, '--', '.'],
      repoPath,
      signal,
    )

    const firstPatch = await runCommand(['git', 'show', '--stat', firstCommit], repoPath, signal)
    await writeFile(join(redoPath, `0001-${firstCommit.slice(0, 8)}.patch.txt`), `${firstPatch.stdout}\n`, 'utf-8')

    const statsMap = new Map<string, CommitStats>()
    for (const commit of selectedCommitsList) {
      const statRaw = await runCommand(
        ['git', 'show', '--numstat', '--pretty=format:', commit.hash],
        repoPath,
        signal,
      )
      statsMap.set(commit.hash, parseNumStat(statRaw.stdout))
    }

    let batches: CommitInfo[][]
    let mappingRule = ''
    if (input.groupingMode === 'one_per_commit') {
      batches = splitIntoBatches(selectedCommitsList, 1, input.maxLectures)
      mappingRule = 'strict: 1 commit -> 1 lecture'
    } else if (input.groupingMode === 'fixed') {
      batches = splitIntoBatches(selectedCommitsList, input.batchSize, input.maxLectures)
      mappingRule = `fixed: ${input.batchSize} commits per lecture`
    } else {
      batches = buildAutoBatches(selectedCommitsList, statsMap, input.maxLectures)
      mappingRule =
        'auto: dense commit => single lecture; sparse commits => grouped (up to 5 commits)'
    }

    const readmeText = await readmeSnippet(repoPath)
    const lectureFiles: string[] = []

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i] as CommitInfo[]
      const changedFiles = await aggregateChangedFiles(repoPath, batch, signal)
      const coding = inferCodingKnowledge(changedFiles)
      const domain = inferDomainKnowledge(repoName, changedFiles, readmeText)
      const content = formatLecture(repoName, i + 1, batch, changedFiles, coding, domain)

      const fileName = `${repoName}-lecture-${String(i + 1).padStart(3, '0')}.md`
      const abs = join(lecturePath, fileName)
      await writeFile(abs, content, 'utf-8')
      lectureFiles.push(abs)
    }

    const index = [
      '---',
      `title: "${repoName} Redo Lectures"`,
      'layout: default',
      '---',
      '',
      `# ${repoName} Redo Lectures`,
      '',
      `- Repo: ${input.repoUrl}`,
      `- Source repo: ${sourceRepoPath}`,
      `- Working repo: ${repoPath}`,
      `- Replay commit: ${firstCommit}`,
      `- Total commits (repo): ${commits.length}`,
      `- Selected commits: ${selectedCommitsList.length}`,
      `- Selected start: ${(selectedCommitsList[0] as CommitInfo).hash}`,
      `- Selected end: ${(selectedCommitsList[selectedCommitsList.length - 1] as CommitInfo).hash}`,
      `- Grouping mode: ${input.groupingMode}`,
      `- Batch size (fixed mode): ${input.batchSize}`,
      `- Mapping rule: ${mappingRule}`,
      `- Temp workspace: ${effectiveUseTempWorkspace}`,
      '',
      '## Lectures',
      ...lectureFiles.map(f => {
        const rel = path.basename(f)
        return `- [${rel}](./${rel})`
      }),
      '',
      '## Replay Artifact',
      `- First selected commit snapshot: ${join(path.basename(redoPath), `0001-${firstCommit.slice(0, 8)}`)}`,
      `- First selected commit patch: ${join(path.basename(redoPath), `0001-${firstCommit.slice(0, 8)}.patch.txt`)}`,
      '',
    ].join('\n')

    await writeFile(join(lecturePath, 'index.md'), index, 'utf-8')

    return {
      data: {
        success: true,
        repoName,
        sourceRepoPath,
        repoPath,
        redoPath,
        lecturePath,
        firstCommit,
        totalCommits: commits.length,
        selectedCommits: selectedCommitsList.length,
        selectedStartCommit: (selectedCommitsList[0] as CommitInfo).hash,
        selectedEndCommit: (selectedCommitsList[selectedCommitsList.length - 1] as CommitInfo).hash,
        lectureFiles,
        message: `Redo completed in ${effectiveUseTempWorkspace ? 'temp workspace' : 'current workspace'}: generated ${lectureFiles.length} lecture(s).`,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const text = content.success
      ? `redotool done for ${content.repoName}\nsource=${content.sourceRepoPath}\nwork=${content.repoPath}\nredo=${content.redoPath}\nlectures=${content.lecturePath}`
      : `redotool failed: ${content.message}`

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
