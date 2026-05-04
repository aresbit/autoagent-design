import { access, appendFile, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

const PM_TOOL_NAME = 'pm-tool'

const DESCRIPTION =
  'Project management tool for AI-assisted coding. Initializes PM files, tracks project progress, records language/architecture decisions, and enforces anti-vibe-coding guardrails.'

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      action: z
        .enum(['init', 'status', 'catchup', 'sync', 'decide'])
        .describe(
          'Action to run: init creates PM files, status checks progress/risk controls, catchup summarizes git diff state, sync appends status+diff to PM log, decide records language/architecture/process decisions with anti-trap checks.',
        ),
      projectName: z
        .string()
        .optional()
        .describe('Optional project name used in the generated pm_charter.md title during init.'),
      decisionType: z
        .enum(['language', 'architecture', 'process'])
        .optional()
        .describe('Required when action="decide". Decision category.'),
      title: z
        .string()
        .optional()
        .describe('Required when action="decide". Short decision title.'),
      options: z
        .array(z.string())
        .optional()
        .describe('Optional alternatives considered for this decision.'),
      chosen: z
        .string()
        .optional()
        .describe('Required when action="decide". Final selected option.'),
      rationale: z
        .string()
        .optional()
        .describe('Required when action="decide". Why this option is selected.'),
      tradeoffs: z
        .string()
        .optional()
        .describe('Optional explicit tradeoff notes.'),
      timeContext: z
        .string()
        .optional()
        .describe(
          'Optional API/history context with explicit dates, e.g. "Provider SDK migration completed on 2026-03-10". Strongly recommended to prevent time-context loss.',
        ),
    })
    .superRefine((value, ctx) => {
      if (value.action !== 'decide') {
        return
      }

      if (!value.decisionType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'decisionType is required when action="decide".',
          path: ['decisionType'],
        })
      }

      if (!value.title?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'title is required when action="decide".',
          path: ['title'],
        })
      }

      if (!value.chosen?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'chosen is required when action="decide".',
          path: ['chosen'],
        })
      }

      if (!value.rationale?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'rationale is required when action="decide".',
          path: ['rationale'],
        })
      }
    }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

type PhaseStatus = 'complete' | 'in_progress' | 'pending'

type RiskKey =
  | 'vibe_coding_risk'
  | 'addiction_fatigue_risk'
  | 'code_awareness_risk'
  | 'design_erosion_risk'
  | 'time_context_risk'

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.enum(['init', 'status', 'catchup', 'sync', 'decide']),
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
    controlTotals: z
      .object({
        total: z.number(),
        checked: z.number(),
        unchecked: z.number(),
      })
      .optional(),
    weeklyBoard: z
      .object({
        weekOf: z.string(),
        goalsTotal: z.number(),
        goalsDone: z.number(),
        blockersOpen: z.number(),
        releaseWindow: z.string(),
      })
      .optional(),
    riskSignals: z.array(z.string()).optional(),
    gitDiffStat: z.string().optional(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const PM_CHARTER_FILENAME = 'pm_charter.md'
const PM_DECISIONS_FILENAME = 'pm_decisions.md'
const PM_PROGRESS_FILENAME = 'pm_progress.md'
const PM_WEEKLY_FILENAME = 'pm_weekly.md'

type PMFile =
  | typeof PM_CHARTER_FILENAME
  | typeof PM_DECISIONS_FILENAME
  | typeof PM_PROGRESS_FILENAME
  | typeof PM_WEEKLY_FILENAME

const PM_FILES: PMFile[] = [
  PM_CHARTER_FILENAME,
  PM_DECISIONS_FILENAME,
  PM_PROGRESS_FILENAME,
  PM_WEEKLY_FILENAME,
]

function nowDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowISOString(): string {
  return new Date().toISOString()
}

function pmCharterTemplate(projectName: string): string {
  return `# PM Charter: ${projectName}

## Operating Model
- Human leads architecture and sequencing.
- AI executes scoped tasks, then human audits and refactors continuously.
- Source principle reference: https://blog.qiaomu.ai/ai-assisted-coding

## Milestones

### Milestone 1: Scope & Baseline
- [ ] Problem statement agreed
- [ ] Success metrics defined
- **Status:** in_progress

### Milestone 2: Stack Decision
- [ ] Language selected and frozen for this milestone
- [ ] Runtime/build constraints documented
- **Status:** pending

### Milestone 3: Architecture Decision
- [ ] Module boundaries documented
- [ ] Core abstractions and data flow documented
- **Status:** pending

### Milestone 4: Implementation & Refactor Loop
- [ ] Feature implementation complete
- [ ] Refactor pass after each bulk AI generation
- **Status:** pending

### Milestone 5: Validation & Delivery
- [ ] Critical tests and validation checks complete
- [ ] Delivery notes prepared
- **Status:** pending

## Anti-Trap Control Checklist
- [ ] Vibe coding constrained: no long unreviewed AI coding streaks
- [ ] Fatigue guardrail enabled: avoid late-night prompt loops
- [ ] Code awareness maintained: read each AI patch and keep module map updated
- [ ] Design decisions made early: no repeated "later" deferrals for core architecture
- [ ] Time context logged: external API evolution notes include explicit dates
`
}

function pmDecisionsTemplate(): string {
  return `# PM Decisions Log

Use this file for language/architecture/process decisions.
Each decision must include alternatives, rationale, tradeoffs, and time context.
`
}

function pmProgressTemplate(): string {
  const date = nowDateString()
  return `# PM Progress Log

## Session: ${date}

### Focus
-

### Completed
-

### Risks
-

### Next
-
`
}

function pmWeeklyTemplate(): string {
  const date = nowDateString()
  return `# Startup-Fast Weekly Board

## Week Of
${date}

## This Week Goals
- [ ] Ship one user-visible increment
- [ ] Close one core technical risk
- [ ] Reduce one delivery bottleneck

## Blockers
- [ ] (none)

## Release Window
Friday 18:00 local

## Notes
- Keep scope tight and prefer shipping over polishing.
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
  const total = (planContent.match(/###\s+Milestone/g) ?? []).length

  const statusMatches = [...planContent.matchAll(/\*\*Status:\*\*\s*(complete|in_progress|pending)/g)]
  let complete = 0
  let inProgress = 0
  let pending = 0

  for (const match of statusMatches) {
    const status = (match[1] ?? 'pending') as PhaseStatus
    if (status === 'complete') complete += 1
    if (status === 'in_progress') inProgress += 1
    if (status === 'pending') pending += 1
  }

  return { total, complete, inProgress, pending }
}

function parseControlTotals(planContent: string): {
  total: number
  checked: number
  unchecked: number
} {
  const controlLines = planContent.match(/^- \[(x| )\] .+$/gm) ?? []
  const total = controlLines.length
  const checked = controlLines.filter(line => line.startsWith('- [x]')).length
  const unchecked = total - checked
  return { total, checked, unchecked }
}

function detectRiskSignals(planContent: string): RiskKey[] {
  const hasChecked = (snippet: string): boolean => {
    const escaped = snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`- \\[x\\] ${escaped}`, 'm').test(planContent)
  }

  const signals: RiskKey[] = []

  if (!hasChecked('Vibe coding constrained: no long unreviewed AI coding streaks')) {
    signals.push('vibe_coding_risk')
  }
  if (!hasChecked('Fatigue guardrail enabled: avoid late-night prompt loops')) {
    signals.push('addiction_fatigue_risk')
  }
  if (!hasChecked('Code awareness maintained: read each AI patch and keep module map updated')) {
    signals.push('code_awareness_risk')
  }
  if (!hasChecked('Design decisions made early: no repeated "later" deferrals for core architecture')) {
    signals.push('design_erosion_risk')
  }
  if (!hasChecked('Time context logged: external API evolution notes include explicit dates')) {
    signals.push('time_context_risk')
  }

  return signals
}

function parseWeeklyBoard(content: string): {
  weekOf: string
  goalsTotal: number
  goalsDone: number
  blockersOpen: number
  releaseWindow: string
} {
  const section = (heading: string, nextHeading: string[]): string => {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const nextGroup = nextHeading
      .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    const regex = new RegExp(
      `## ${escapedHeading}\\n([\\s\\S]*?)(?:\\n## (?:${nextGroup})|$)`,
      'm',
    )
    const match = content.match(regex)
    return (match?.[1] ?? '').trim()
  }

  const weekOfRaw = section('Week Of', ['This Week Goals', 'Blockers', 'Release Window', 'Notes'])
  const goalsRaw = section('This Week Goals', ['Blockers', 'Release Window', 'Notes'])
  const blockersRaw = section('Blockers', ['Release Window', 'Notes'])
  const releaseWindowRaw = section('Release Window', ['Notes'])

  const goalLines = goalsRaw.match(/^- \[(x| )\] .+$/gm) ?? []
  const blockerLines = blockersRaw.match(/^- \[(x| )\] .+$/gm) ?? []
  const goalsDone = goalLines.filter(line => line.startsWith('- [x]')).length
  const blockersOpen = blockerLines.filter(line => !line.startsWith('- [x]')).length

  return {
    weekOf: weekOfRaw || 'unknown',
    goalsTotal: goalLines.length,
    goalsDone,
    blockersOpen,
    releaseWindow: releaseWindowRaw || 'not set',
  }
}

function decisionRiskSignals(input: Input): RiskKey[] {
  const signals: RiskKey[] = []
  const options = input.options ?? []

  if (options.length < 2) {
    signals.push('design_erosion_risk')
  }

  if (!input.tradeoffs?.trim()) {
    signals.push('vibe_coding_risk')
  }

  if (!input.timeContext?.trim()) {
    signals.push('time_context_risk')
  }

  if ((input.rationale?.trim().length ?? 0) < 40) {
    signals.push('code_awareness_risk')
  }

  return Array.from(new Set(signals))
}

async function runInit(projectRoot: string, projectName?: string): Promise<Output> {
  const safeProjectName = projectName?.trim() || 'project'

  const filesCreated: string[] = []
  const filesExisting: string[] = []

  const fileMap: Record<PMFile, string> = {
    [PM_CHARTER_FILENAME]: pmCharterTemplate(safeProjectName),
    [PM_DECISIONS_FILENAME]: pmDecisionsTemplate(),
    [PM_PROGRESS_FILENAME]: pmProgressTemplate(),
    [PM_WEEKLY_FILENAME]: pmWeeklyTemplate(),
  }

  for (const filename of PM_FILES) {
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
      ? `Initialized PM files in ${projectRoot}. Created: ${filesCreated.join(', ')}.`
      : `PM files already exist in ${projectRoot}: ${filesExisting.join(', ')}.`

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
  const charterPath = join(projectRoot, PM_CHARTER_FILENAME)
  if (!(await exists(charterPath))) {
    return {
      success: false,
      action: 'status',
      projectRoot,
      summary: 'No pm_charter.md found. Run action="init" first.',
      phaseTotals: {
        total: 0,
        complete: 0,
        inProgress: 0,
        pending: 0,
      },
      controlTotals: {
        total: 0,
        checked: 0,
        unchecked: 0,
      },
      riskSignals: [],
    }
  }

  const content = await readFile(charterPath, 'utf-8')
  const weeklyPath = join(projectRoot, PM_WEEKLY_FILENAME)
  const weeklyContent = (await exists(weeklyPath))
    ? await readFile(weeklyPath, 'utf-8')
    : ''
  const phaseTotals = parsePhaseTotals(content)
  const controlTotals = parseControlTotals(content)
  const riskSignals = detectRiskSignals(content)
  const weeklyBoard = weeklyContent
    ? parseWeeklyBoard(weeklyContent)
    : {
        weekOf: 'unknown',
        goalsTotal: 0,
        goalsDone: 0,
        blockersOpen: 0,
        releaseWindow: 'not set',
      }

  const summaryParts: string[] = []

  if (phaseTotals.total > 0 && phaseTotals.complete === phaseTotals.total) {
    summaryParts.push(`All milestones complete (${phaseTotals.complete}/${phaseTotals.total}).`)
  } else {
    summaryParts.push(
      `Project in progress (${phaseTotals.complete}/${phaseTotals.total} complete, ${phaseTotals.inProgress} in progress, ${phaseTotals.pending} pending).`,
    )
  }

  summaryParts.push(
    `Control checklist ${controlTotals.checked}/${controlTotals.total} checked; ${riskSignals.length} active risk signals.`,
  )
  summaryParts.push(
    `Weekly board ${weeklyBoard.goalsDone}/${weeklyBoard.goalsTotal} goals done, blockers=${weeklyBoard.blockersOpen}, release=${weeklyBoard.releaseWindow}.`,
  )

  return {
    success: true,
    action: 'status',
    projectRoot,
    summary: summaryParts.join(' '),
    phaseTotals,
    controlTotals,
    weeklyBoard,
    riskSignals,
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
    ? 'Unsynced workspace changes found. Reconcile PM files with current diff and decision log.'
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
  const progressPath = join(projectRoot, PM_PROGRESS_FILENAME)
  if (!(await exists(progressPath))) {
    return {
      success: false,
      action: 'sync',
      projectRoot,
      summary: 'No pm_progress.md found. Run action="init" first.',
      gitDiffStat: '',
    }
  }

  const [status, catchup] = await Promise.all([runStatus(projectRoot), runCatchup(projectRoot)])

  if (!catchup.success) {
    return {
      ...catchup,
      action: 'sync',
    }
  }

  const timestamp = nowISOString()
  const diffContent = catchup.gitDiffStat || '(clean working tree)'
  const riskLine = status.riskSignals && status.riskSignals.length > 0
    ? status.riskSignals.join(', ')
    : '(none)'
  const weeklyLine = status.weeklyBoard
    ? `${status.weeklyBoard.weekOf} | goals ${status.weeklyBoard.goalsDone}/${status.weeklyBoard.goalsTotal} | blockers ${status.weeklyBoard.blockersOpen} | release ${status.weeklyBoard.releaseWindow}`
    : '(weekly board unavailable)'

  const logEntry = `\n\n## Sync ${timestamp}\n- ${status.summary}\n- Risks: ${riskLine}\n- Weekly: ${weeklyLine}\n\n\`\`\`\n${diffContent}\n\`\`\`\n`

  await appendFile(progressPath, logEntry, 'utf-8')

  return {
    success: true,
    action: 'sync',
    projectRoot,
    summary: `Synced PM state to ${PM_PROGRESS_FILENAME}.`,
    gitDiffStat: catchup.gitDiffStat,
    weeklyBoard: status.weeklyBoard,
    riskSignals: status.riskSignals,
  }
}

async function runDecide(projectRoot: string, input: Input): Promise<Output> {
  const decisionsPath = join(projectRoot, PM_DECISIONS_FILENAME)
  if (!(await exists(decisionsPath))) {
    return {
      success: false,
      action: 'decide',
      projectRoot,
      summary: 'No pm_decisions.md found. Run action="init" first.',
      riskSignals: [],
    }
  }

  const timestamp = nowISOString()
  const options = input.options?.filter(item => item.trim().length > 0) ?? []
  const risks = decisionRiskSignals(input)

  const entry = `\n\n## Decision ${timestamp}: ${input.title}\n- Type: ${input.decisionType}\n- Chosen: ${input.chosen}\n- Options considered: ${options.length > 0 ? options.join(' | ') : '(none recorded)'}\n- Rationale: ${input.rationale}\n- Tradeoffs: ${input.tradeoffs?.trim() || '(not recorded)'}\n- Time context: ${input.timeContext?.trim() || '(not recorded)'}\n- Guardrail risk signals: ${risks.length > 0 ? risks.join(', ') : '(none)'}\n`

  await appendFile(decisionsPath, entry, 'utf-8')

  const summary =
    risks.length > 0
      ? `Decision recorded with ${risks.length} risk signal(s): ${risks.join(', ')}.`
      : 'Decision recorded with no active guardrail risks.'

  return {
    success: true,
    action: 'decide',
    projectRoot,
    summary,
    riskSignals: risks,
  }
}

export const PMTool = buildTool({
  name: PM_TOOL_NAME,
  searchHint: 'project management guardrail tool for progress, stack, architecture decisions',
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
  userFacingName,
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.action}`
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input: Input) {
    const projectRoot = getCwd()

    if (input.action === 'init') {
      return { data: await runInit(projectRoot, input.projectName) }
    }

    if (input.action === 'status') {
      return { data: await runStatus(projectRoot) }
    }

    if (input.action === 'sync') {
      return { data: await runSync(projectRoot) }
    }

    if (input.action === 'decide') {
      return { data: await runDecide(projectRoot, input) }
    }

    return { data: await runCatchup(projectRoot) }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const contentLines = [output.summary]

    if (output.filesCreated && output.filesCreated.length > 0) {
      contentLines.push(`Created: ${output.filesCreated.join(', ')}`)
    }

    if (output.phaseTotals) {
      contentLines.push(
        `Milestones: complete=${output.phaseTotals.complete}, in_progress=${output.phaseTotals.inProgress}, pending=${output.phaseTotals.pending}, total=${output.phaseTotals.total}`,
      )
    }

    if (output.controlTotals) {
      contentLines.push(
        `Controls: checked=${output.controlTotals.checked}, unchecked=${output.controlTotals.unchecked}, total=${output.controlTotals.total}`,
      )
    }

    if (output.weeklyBoard) {
      contentLines.push(
        `Weekly: week=${output.weeklyBoard.weekOf}, goals_done=${output.weeklyBoard.goalsDone}/${output.weeklyBoard.goalsTotal}, blockers_open=${output.weeklyBoard.blockersOpen}, release_window=${output.weeklyBoard.releaseWindow}`,
      )
    }

    if (output.riskSignals && output.riskSignals.length > 0) {
      contentLines.push(`Risks: ${output.riskSignals.join(', ')}`)
    }

    if (typeof output.gitDiffStat === 'string') {
      contentLines.push(output.gitDiffStat || '(clean working tree)')
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: contentLines.join('\n'),
      is_error: output.success !== true,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
