import { access, appendFile, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

const SE_TOOL_NAME = 'se-tool'

const DESCRIPTION =
  'System engineering planning tool based on planning-with-files. Initializes planning files, checks completion status, and generates session catchup from git diff stats.'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['init', 'status', 'catchup', 'sync'])
      .describe(
        'Action to run: init creates planning files, status checks phase completion, catchup summarizes unsynced workspace changes, sync appends current diff status to progress.md.',
      ),
    projectName: z
      .string()
      .optional()
      .describe('Optional project name used in the generated task_plan.md title during init.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

type PhaseStatus = 'complete' | 'in_progress' | 'pending'

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.enum(['init', 'status', 'catchup', 'sync']),
    projectRoot: z.string(),
    summary: z.string(),
    filesCreated: z.array(z.string()).optional(),
    filesExisting: z.array(z.string()).optional(),
    phaseTotals: z
      .object({
        total: z.number(),
        complete: z.number(),
        inProgress: z.number(),
        pending: z.number(),
      })
      .optional(),
    gitDiffStat: z.string().optional(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const TASK_PLAN_FILENAME = 'task_plan.md'
const FINDINGS_FILENAME = 'findings.md'
const PROGRESS_FILENAME = 'progress.md'

type PlanningFile = typeof TASK_PLAN_FILENAME | typeof FINDINGS_FILENAME | typeof PROGRESS_FILENAME

const PLANNING_FILES: PlanningFile[] = [
  TASK_PLAN_FILENAME,
  FINDINGS_FILENAME,
  PROGRESS_FILENAME,
]

function nowDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function taskPlanTemplate(projectName: string): string {
  return `# Task Plan: ${projectName}

## Goal
[One sentence describing the end state]

## Current Phase
Phase 1

## Phases

### Phase 1: Requirements & Discovery
- [ ] Understand user intent
- [ ] Identify constraints
- [ ] Document in findings.md
- **Status:** in_progress

### Phase 2: Planning & Structure
- [ ] Define approach
- [ ] Create project structure
- **Status:** pending

### Phase 3: Implementation
- [ ] Execute the plan
- [ ] Write to files before executing
- **Status:** pending

### Phase 4: Testing & Verification
- [ ] Verify requirements met
- [ ] Document test results
- **Status:** pending

### Phase 5: Delivery
- [ ] Review outputs
- [ ] Deliver to user
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|

## Errors Encountered
| Error | Resolution |
|-------|------------|
`
}

function findingsTemplate(): string {
  return `# Findings & Decisions

## Requirements
-

## Research Findings
-

## Technical Decisions
| Decision | Rationale |
|----------|-----------|

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
-
`
}

function progressTemplate(): string {
  const date = nowDateString()
  return `# Progress Log

## Session: ${date}

### Current Status
- **Phase:** 1 - Requirements & Discovery
- **Started:** ${date}

### Actions Taken
-

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|

### Errors
| Error | Resolution |
|-------|------------|
`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function parsePhaseTotals(planContent: string): {
  total: number
  complete: number
  inProgress: number
  pending: number
} {
  const total = (planContent.match(/###\s+Phase/g) ?? []).length

  const statusMatches = [...planContent.matchAll(/\*\*Status:\*\*\s*(complete|in_progress|pending)/g)]
  let complete = 0
  let inProgress = 0
  let pending = 0

  if (statusMatches.length > 0) {
    for (const match of statusMatches) {
      const status = (match[1] ?? 'pending') as PhaseStatus
      if (status === 'complete') complete += 1
      if (status === 'in_progress') inProgress += 1
      if (status === 'pending') pending += 1
    }
  } else {
    complete = (planContent.match(/\[complete\]/g) ?? []).length
    inProgress = (planContent.match(/\[in_progress\]/g) ?? []).length
    pending = (planContent.match(/\[pending\]/g) ?? []).length
  }

  return { total, complete, inProgress, pending }
}

async function runInit(projectRoot: string, projectName?: string): Promise<Output> {
  const safeProjectName = projectName?.trim() || 'project'

  const filesCreated: string[] = []
  const filesExisting: string[] = []

  const fileMap: Record<PlanningFile, string> = {
    [TASK_PLAN_FILENAME]: taskPlanTemplate(safeProjectName),
    [FINDINGS_FILENAME]: findingsTemplate(),
    [PROGRESS_FILENAME]: progressTemplate(),
  }

  for (const filename of PLANNING_FILES) {
    const fullPath = join(projectRoot, filename)
    if (await exists(fullPath)) {
      filesExisting.push(filename)
      continue
    }

    await writeFile(fullPath, fileMap[filename], 'utf-8')
    filesCreated.push(filename)
  }

  const summary =
    filesCreated.length > 0
      ? `Initialized planning files in ${projectRoot}. Created: ${filesCreated.join(', ')}.`
      : `Planning files already exist in ${projectRoot}: ${filesExisting.join(', ')}.`

  return {
    success: true,
    action: 'init',
    projectRoot,
    summary,
    filesCreated,
    filesExisting,
  }
}

async function runStatus(projectRoot: string): Promise<Output> {
  const planPath = join(projectRoot, TASK_PLAN_FILENAME)
  if (!(await exists(planPath))) {
    return {
      success: false,
      action: 'status',
      projectRoot,
      summary: 'No task_plan.md found. Run action="init" first.',
      phaseTotals: {
        total: 0,
        complete: 0,
        inProgress: 0,
        pending: 0,
      },
    }
  }

  const content = await readFile(planPath, 'utf-8')
  const totals = parsePhaseTotals(content)

  const summary =
    totals.total > 0 && totals.complete === totals.total
      ? `All phases complete (${totals.complete}/${totals.total}).`
      : `Task in progress (${totals.complete}/${totals.total} complete, ${totals.inProgress} in progress, ${totals.pending} pending).`

  return {
    success: true,
    action: 'status',
    projectRoot,
    summary,
    phaseTotals: totals,
  }
}

async function runCatchup(projectRoot: string): Promise<Output> {
  const diff = await execFileNoThrowWithCwd('git', ['diff', '--stat'], {
    cwd: projectRoot,
  })

  if (diff.code !== 0) {
    const errorMessage = (diff.stderr || diff.error || 'git diff --stat failed').trim()
    return {
      success: false,
      action: 'catchup',
      projectRoot,
      summary: `Cannot generate catchup: ${errorMessage}`,
      gitDiffStat: '',
    }
  }

  const gitDiffStat = diff.stdout.trim()
  const summary = gitDiffStat
    ? 'Unsynced workspace changes found. Reconcile task_plan.md/progress.md with current diff.'
    : 'No unsynced workspace changes detected by git diff --stat.'

  return {
    success: true,
    action: 'catchup',
    projectRoot,
    summary,
    gitDiffStat,
  }
}

async function runSync(projectRoot: string): Promise<Output> {
  const progressPath = join(projectRoot, PROGRESS_FILENAME)
  if (!(await exists(progressPath))) {
    return {
      success: false,
      action: 'sync',
      projectRoot,
      summary: 'No progress.md found. Run action="init" first.',
      gitDiffStat: '',
    }
  }

  const catchup = await runCatchup(projectRoot)
  if (!catchup.success) {
    return {
      ...catchup,
      action: 'sync',
    }
  }

  const timestamp = new Date().toISOString()
  const diffContent = catchup.gitDiffStat || '(clean working tree)'
  const logEntry = `\n\n### Sync ${timestamp}\n- ${catchup.summary}\n\n\`\`\`\n${diffContent}\n\`\`\`\n`
  await appendFile(progressPath, logEntry, 'utf-8')

  return {
    success: true,
    action: 'sync',
    projectRoot,
    summary: `Synced workspace state to ${PROGRESS_FILENAME}.`,
    gitDiffStat: catchup.gitDiffStat,
  }
}

export const SETool = buildTool({
  name: SE_TOOL_NAME,
  searchHint: 'system engineering planner with persistent markdown files',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
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
    return 'SETool'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.action}`
  },
  async call(input: Input, context) {
    const projectRoot = getCwd()

    if (input.action === 'init') {
      return { data: await runInit(projectRoot, input.projectName) }
    }

    if (input.action === 'status') {
      return { data: await runStatus(projectRoot) }
    }

    if (input.action === 'sync') {
      return {
        data: await runSync(projectRoot),
      }
    }

    return {
      data: await runCatchup(projectRoot),
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const contentLines = [output.summary]

    if (output.filesCreated && output.filesCreated.length > 0) {
      contentLines.push(`Created: ${output.filesCreated.join(', ')}`)
    }

    if (output.phaseTotals) {
      contentLines.push(
        `Phases: complete=${output.phaseTotals.complete}, in_progress=${output.phaseTotals.inProgress}, pending=${output.phaseTotals.pending}, total=${output.phaseTotals.total}`,
      )
    }

    if (typeof output.gitDiffStat === 'string') {
      contentLines.push(output.gitDiffStat || '(clean working tree)')
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: contentLines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
