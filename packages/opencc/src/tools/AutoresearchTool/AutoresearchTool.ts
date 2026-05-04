import { access, readFile, rm, stat, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runAgent } from '../AgentTool/runAgent.js'
import type { Message } from '../../types/message.js'
import { GENERAL_PURPOSE_AGENT } from '../AgentTool/built-in/generalPurposeAgent.js'
import { createUserMessage } from '../../utils/messages.js'
import { getCwd } from '../../utils/cwd.js'
import { exec } from '../../utils/Shell.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'start',
        'status',
        'off',
        'clear',
        'init_experiment',
        'run_experiment',
        'log_experiment',
      ])
      .optional()
      .describe('Action to perform. Default: start'),
    goal: z.string().optional().describe('The optimization goal to achieve (e.g., reduce test runtime)'),
    scope: z.string().optional().describe('File glob pattern defining which files can be modified'),
    metric: z.string().optional().describe('Primary metric to optimize (e.g., total_µs, throughput)'),
    verify: z
      .string()
      .optional()
      .describe('Benchmark command that outputs/derives the primary metric'),
    iterations: z.number().int().min(1).max(500).optional().describe('Maximum iteration count'),
    guard: z.string().optional().describe('Correctness guard command that must pass before keep'),
    workingDir: z
      .string()
      .optional()
      .describe('Override working directory. Relative path resolves from current cwd'),
    resume: z
      .boolean()
      .optional()
      .describe('Resume existing autoresearch session files when present (default: true)'),
    name: z.string().optional().describe('Experiment name for init_experiment'),
    metric_name: z.string().optional().describe('Primary metric key for init_experiment'),
    metric_unit: z.string().optional().describe('Metric unit label for init_experiment'),
    direction: z
      .enum(['lower', 'higher'])
      .optional()
      .describe('Whether lower or higher metric is better for init_experiment'),
    command: z
      .string()
      .optional()
      .describe('Benchmark command for run_experiment. If autoresearch.sh exists, it must be used'),
    checks_timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .describe('Timeout in seconds for autoresearch.checks.sh'),
    status: z
      .enum(['keep', 'discard', 'crash', 'checks_failed'])
      .optional()
      .describe('Final status for log_experiment'),
    metric_value: z.number().optional().describe('Primary metric value for log_experiment'),
    description: z.string().optional().describe('One-line summary for log_experiment'),
    metrics: z
      .record(z.string(), z.number())
      .optional()
      .describe('Secondary metrics map for log_experiment'),
    force: z
      .boolean()
      .optional()
      .describe('Allow introducing new secondary metrics in log_experiment'),
    asi: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Actionable side information recorded with log_experiment'),
    auto_stop_non_keep_streak: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Auto-stop threshold: stop loop after N consecutive non-keep results'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const sessionSchema = z.object({
  workDir: z.string(),
  goal: z.string().optional(),
  totalRuns: z.number(),
  keep: z.number(),
  discard: z.number(),
  crash: z.number(),
  checksFailed: z.number(),
  keepRate: z.number(),
  metricName: z.string().optional(),
  lastMetric: z.number().optional(),
  nonKeepStreak: z
    .object({
      current: z.number(),
      limit: z.number(),
    })
    .optional(),
  stopReason: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the autoresearch action succeeded'),
    mode: z
      .enum(['active', 'inactive'])
      .describe('Autoresearch mode after this call'),
    action: z
      .enum([
        'start',
        'status',
        'off',
        'clear',
        'init_experiment',
        'run_experiment',
        'log_experiment',
      ])
      .describe('Executed action'),
    message: z.string().describe('Status message'),
    session: sessionSchema.optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
export type AutoresearchProgress = {
  type: 'autoresearch_progress'
  iteration: number
  message: Message
}

const AUTORESEARCH_CONFIG = 'autoresearch.config.json'
const AUTORESEARCH_RUNTIME = '.autoresearch.runtime.json'
const AUTORESEARCH_JSONL = 'autoresearch.jsonl'
const AUTORESEARCH_MD = 'autoresearch.md'
const AUTORESEARCH_IDEAS = 'autoresearch.ideas.md'
const AUTORESEARCH_SH = 'autoresearch.sh'
const AUTORESEARCH_CHECKS = 'autoresearch.checks.sh'
const DEFAULT_ITERATIONS = 10
const DEFAULT_AUTO_STOP_NON_KEEP_STREAK = 3

type SessionMode = 'active' | 'inactive'
type ExperimentStatus = 'keep' | 'discard' | 'crash' | 'checks_failed'
type MetricDirection = 'lower' | 'higher'
type AutoresearchAction = NonNullable<Input['action']>

interface RuntimeState {
  mode: SessionMode
  workDir: string
  goal?: string
  updatedAt: string
  experiment?: RuntimeExperimentState
}
interface RuntimeExperimentState {
  name: string
  metricName: string
  metricUnit: string
  direction: MetricDirection
  maxIterations: number
  runCount: number
  secondaryMetrics: string[]
  currentSegment: number
  bestMetric?: number
  autoStopNonKeepStreak: number
  currentNonKeepStreak: number
  stopReason?: string
  lastRun?: RuntimeLastRun
}
interface RuntimeLastRun {
  command: string
  benchmarkPassed: boolean
  durationSeconds: number
  outputTail: string
  parsedPrimaryMetric?: number
  parsedMetrics: Record<string, number>
  checksPass: boolean | null
  checksTimedOut: boolean
  checksOutputTail: string
}

interface SessionSummary {
  totalRuns: number
  keep: number
  discard: number
  crash: number
  checksFailed: number
  lastMetric?: number
  configMetric?: string
}
interface SessionSnapshot {
  workDir: string
  goal?: string
  totalRuns: number
  keep: number
  discard: number
  crash: number
  checksFailed: number
  keepRate: number
  metricName?: string
  lastMetric?: number
  experimentName?: string
  direction?: MetricDirection
  pendingRun?: {
    command: string
    benchmarkPassed: boolean
    checksPass: boolean | null
    checksTimedOut: boolean
    durationSeconds: number
  }
  nonKeepStreak?: {
    current: number
    limit: number
  }
  stopReason?: string
}

interface ConfigOverrides {
  maxIterations: number | null
  workingDir: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function jsonErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isDir(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath)
    return s.isDirectory()
  } catch {
    return false
  }
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function tailLines(text: string, maxLines = 80): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text.trim()
  return lines.slice(-maxLines).join('\n').trim()
}

function parseMetricLines(output: string): Record<string, number> {
  const metrics: Record<string, number> = {}
  const lines = output.split('\n')
  const metricLine = /^\s*METRIC\s+([A-Za-z0-9_.\-µ%]+)\s*=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i
  for (const line of lines) {
    const m = metricLine.exec(line)
    if (!m) continue
    const val = Number(m[2])
    if (Number.isFinite(val)) {
      metrics[m[1]] = val
    }
  }
  return metrics
}

function getPrimaryMetric(metrics: Record<string, number>, metricName: string): number | undefined {
  if (typeof metrics[metricName] === 'number') return metrics[metricName]
  const first = Object.values(metrics).find(v => Number.isFinite(v))
  return first
}

function isAutoresearchShCommand(command: string): boolean {
  const cmd = command.trim()
  return /^(?:(?:bash|sh)\s+(?:-\w+\s+)*)?(?:\.\/|\/[\w/.-]*\/)?autoresearch\.sh(?:\s|$)/.test(cmd)
}

async function runBashCommand(
  workDir: string,
  command: string,
  abortSignal: AbortSignal,
  timeoutMs: number,
): Promise<{
  code: number
  stdout: string
  stderr: string
  combined: string
  interrupted: boolean
}> {
  const wrapped = `cd ${shQuote(workDir)} && ${command}`
  const shellCommand = await exec(wrapped, abortSignal, 'bash', {
    timeout: timeoutMs,
    preventCwdChanges: true,
  })
  const result = await shellCommand.result
  shellCommand.cleanup()
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    combined,
    interrupted: result.interrupted,
  }
}

async function readConfig(cwd: string): Promise<ConfigOverrides> {
  const configPath = join(cwd, AUTORESEARCH_CONFIG)
  if (!(await exists(configPath))) {
    return { maxIterations: null, workingDir: null }
  }

  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      maxIterations?: unknown
      workingDir?: unknown
    }
    const maxIterations =
      typeof parsed.maxIterations === 'number' &&
      Number.isFinite(parsed.maxIterations) &&
      parsed.maxIterations > 0
        ? Math.floor(parsed.maxIterations)
        : null
    const workingDir = typeof parsed.workingDir === 'string' && parsed.workingDir.trim()
      ? parsed.workingDir.trim()
      : null
    return { maxIterations, workingDir }
  } catch {
    return { maxIterations: null, workingDir: null }
  }
}

async function resolveWorkingDir(input: Input): Promise<{ ok: true; cwd: string; workDir: string; maxIterations: number } | { ok: false; error: string }> {
  const cwd = getCwd()
  const cfg = await readConfig(cwd)
  const rawWorkDir = input.workingDir ?? cfg.workingDir ?? cwd
  const workDir = isAbsolute(rawWorkDir) ? rawWorkDir : resolve(cwd, rawWorkDir)

  if (!(await isDir(workDir))) {
    return {
      ok: false,
      error: `Working directory does not exist or is not a directory: ${workDir}`,
    }
  }

  const maxIterations = input.iterations ?? cfg.maxIterations ?? DEFAULT_ITERATIONS
  return { ok: true, cwd, workDir, maxIterations }
}

function runtimePath(cwd: string): string {
  return join(cwd, AUTORESEARCH_RUNTIME)
}

async function readRuntime(cwd: string): Promise<RuntimeState | null> {
  const p = runtimePath(cwd)
  if (!(await exists(p))) return null
  try {
    const raw = await readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RuntimeState>
    if (parsed && (parsed.mode === 'active' || parsed.mode === 'inactive')) {
      const exp = parsed.experiment
      const experiment =
        exp &&
        typeof exp.name === 'string' &&
        typeof exp.metricName === 'string' &&
        typeof exp.metricUnit === 'string' &&
        (exp.direction === 'lower' || exp.direction === 'higher')
          ? {
              name: exp.name,
              metricName: exp.metricName,
              metricUnit: exp.metricUnit,
              direction: exp.direction,
              maxIterations:
                typeof exp.maxIterations === 'number' && exp.maxIterations > 0
                  ? Math.floor(exp.maxIterations)
                  : DEFAULT_ITERATIONS,
              runCount: typeof exp.runCount === 'number' ? Math.max(0, Math.floor(exp.runCount)) : 0,
              secondaryMetrics: Array.isArray(exp.secondaryMetrics)
                ? exp.secondaryMetrics.filter((m): m is string => typeof m === 'string')
                : [],
              currentSegment: typeof exp.currentSegment === 'number' ? Math.max(0, Math.floor(exp.currentSegment)) : 0,
              bestMetric: typeof exp.bestMetric === 'number' ? exp.bestMetric : undefined,
              autoStopNonKeepStreak:
                typeof exp.autoStopNonKeepStreak === 'number' && exp.autoStopNonKeepStreak > 0
                  ? Math.floor(exp.autoStopNonKeepStreak)
                  : DEFAULT_AUTO_STOP_NON_KEEP_STREAK,
              currentNonKeepStreak:
                typeof exp.currentNonKeepStreak === 'number' && exp.currentNonKeepStreak >= 0
                  ? Math.floor(exp.currentNonKeepStreak)
                  : 0,
              stopReason: typeof exp.stopReason === 'string' ? exp.stopReason : undefined,
              lastRun: exp.lastRun,
            }
          : undefined
      return {
        mode: parsed.mode,
        workDir: typeof parsed.workDir === 'string' ? parsed.workDir : cwd,
        goal: typeof parsed.goal === 'string' ? parsed.goal : undefined,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
        experiment,
      }
    }
    return null
  } catch {
    return null
  }
}

async function writeRuntime(cwd: string, state: RuntimeState): Promise<void> {
  await writeFile(runtimePath(cwd), JSON.stringify(state, null, 2), 'utf-8')
}

async function maybeSeedAutoresearchMd(workDir: string, input: Input, maxIterations: number): Promise<boolean> {
  const mdPath = join(workDir, AUTORESEARCH_MD)
  if (await exists(mdPath)) return false

  const body = [
    `# Autoresearch: ${input.goal ?? 'Optimization Session'}`,
    '',
    '## Objective',
    input.goal ?? 'TBD',
    '',
    '## Primary Metric',
    input.metric ?? 'TBD',
    '',
    '## Benchmark Command',
    input.verify ?? `bash ${AUTORESEARCH_SH}`,
    '',
    '## Guard Command',
    input.guard ?? '(optional)',
    '',
    '## Scope',
    input.scope ?? '(not constrained)',
    '',
    '## Max Iterations',
    String(maxIterations),
    '',
    '## Rules',
    '- Run baseline first.',
    '- Small, reversible changes each iteration.',
    '- Keep only when primary metric improves and guards pass.',
    '- On discard/crash/checks_failed, revert code changes but preserve autoresearch files.',
    '',
    '## What Has Been Tried',
    '- (append every iteration)',
    '',
  ].join('\n')

  await writeFile(mdPath, body, 'utf-8')
  return true
}

async function parseSessionSummary(workDir: string): Promise<SessionSummary> {
  const summary: SessionSummary = {
    totalRuns: 0,
    keep: 0,
    discard: 0,
    crash: 0,
    checksFailed: 0,
  }

  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
  if (!(await exists(jsonlPath))) return summary

  try {
    const raw = await readFile(jsonlPath, 'utf-8')
    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as Record<string, unknown>
        if (rec.type === 'config') {
          if (typeof rec.metricName === 'string') summary.configMetric = rec.metricName
          continue
        }
        const status = typeof rec.status === 'string' ? rec.status : ''
        if (status) summary.totalRuns += 1
        if (status === 'keep') summary.keep += 1
        if (status === 'discard') summary.discard += 1
        if (status === 'crash') summary.crash += 1
        if (status === 'checks_failed') summary.checksFailed += 1
        if (typeof rec.metric === 'number') summary.lastMetric = rec.metric
      } catch {
        // Ignore malformed lines and continue parsing.
      }
    }
  } catch {
    // Ignore read failures and return what we have.
  }

  return summary
}

async function buildStatusMessage(cwd: string, workDir: string): Promise<string> {
  const [runtime, summary] = await Promise.all([
    readRuntime(cwd),
    parseSessionSummary(workDir),
  ])

  const files = [
    AUTORESEARCH_MD,
    AUTORESEARCH_JSONL,
    AUTORESEARCH_SH,
    AUTORESEARCH_CHECKS,
    AUTORESEARCH_IDEAS,
  ]
  const fileStates = await Promise.all(files.map(async f => ({ name: f, present: await exists(join(workDir, f)) })))

  const lines: string[] = []
  lines.push(`Mode: ${runtime?.mode ?? 'inactive'}`)
  lines.push(`Work dir: ${workDir}`)
  if (runtime?.goal) lines.push(`Goal: ${runtime.goal}`)
  lines.push(`Runs: ${summary.totalRuns} (keep=${summary.keep}, discard=${summary.discard}, crash=${summary.crash}, checks_failed=${summary.checksFailed})`)
  if (summary.configMetric || typeof summary.lastMetric === 'number') {
    lines.push(`Metric: ${summary.configMetric ?? 'metric'}${typeof summary.lastMetric === 'number' ? `, last=${summary.lastMetric}` : ''}`)
  }
  lines.push(`Files: ${fileStates.map(f => `${f.name}:${f.present ? 'yes' : 'no'}`).join(', ')}`)
  return lines.join('\n')
}

async function buildSessionSnapshot(cwd: string, workDir: string): Promise<SessionSnapshot> {
  const [runtime, summary] = await Promise.all([
    readRuntime(cwd),
    parseSessionSummary(workDir),
  ])
  const keepRate = summary.totalRuns > 0 ? (summary.keep / summary.totalRuns) * 100 : 0
  return {
    workDir,
    goal: runtime?.goal,
    totalRuns: summary.totalRuns,
    keep: summary.keep,
    discard: summary.discard,
    crash: summary.crash,
    checksFailed: summary.checksFailed,
    keepRate,
    metricName: summary.configMetric,
    lastMetric: summary.lastMetric,
    experimentName: runtime?.experiment?.name,
    direction: runtime?.experiment?.direction,
    pendingRun: runtime?.experiment?.lastRun
      ? {
          command: runtime.experiment.lastRun.command,
          benchmarkPassed: runtime.experiment.lastRun.benchmarkPassed,
          checksPass: runtime.experiment.lastRun.checksPass,
          checksTimedOut: runtime.experiment.lastRun.checksTimedOut,
          durationSeconds: runtime.experiment.lastRun.durationSeconds,
        }
      : undefined,
    nonKeepStreak: runtime?.experiment
      ? {
          current: runtime.experiment.currentNonKeepStreak,
          limit: runtime.experiment.autoStopNonKeepStreak,
        }
      : undefined,
    stopReason: runtime?.experiment?.stopReason,
  }
}

function buildAutoresearchPrompt(input: Input, params: { workDir: string; maxIterations: number; resumeContext: string; hasAutoresearchSh: boolean; hasChecks: boolean }): string {
  const { workDir, maxIterations, resumeContext, hasAutoresearchSh, hasChecks } = params
  const verifyCommand = hasAutoresearchSh ? `bash ${AUTORESEARCH_SH}` : (input.verify ?? `bash ${AUTORESEARCH_SH}`)
  const guardCommand = input.guard ?? (hasChecks ? `bash ${AUTORESEARCH_CHECKS}` : '(none)')
  const scope = input.scope ?? '(not constrained)'
  const metric = input.metric ?? 'primary metric from benchmark output'
  const goal = input.goal ?? 'Continue existing autoresearch objective'

  const sections = [
    'You are running in AUTORESEARCH MODE. Execute an autonomous optimization loop and do not stop early.',
    '',
    'Session parameters:',
    `- Goal: ${goal}`,
    `- Work directory: ${workDir}`,
    `- Scope: ${scope}`,
    `- Primary metric: ${metric}`,
    `- Benchmark command: ${verifyCommand}`,
    `- Guard command: ${guardCommand}`,
    `- Max iterations: ${maxIterations}`,
    '',
    'Mandatory protocol (in order):',
    `1. Read ${AUTORESEARCH_MD} first (if present), then scan recent git log and ${AUTORESEARCH_JSONL} if present.`,
    `2. Establish/confirm baseline by running benchmark before optimization.`,
    '3. For each iteration: write a concise hypothesis, apply a small change, run benchmark, evaluate result.',
    `4. If ${AUTORESEARCH_CHECKS} exists and benchmark passed, run it. If checks fail/timed out => status must be checks_failed (never keep).`,
    `5. Log every iteration to ${AUTORESEARCH_JSONL} with JSON fields: run, status(keep|discard|crash|checks_failed), metric, metrics(optional), description, timestamp, asi.`,
    '6. keep: commit change with metric delta in commit message. discard/crash/checks_failed: revert code changes while preserving autoresearch files.',
    `7. Continuously update ${AUTORESEARCH_MD} "What Has Been Tried"; put deferred ideas into ${AUTORESEARCH_IDEAS}.`,
    `8. Stop only when max iterations reached, no promising hypotheses remain, or user interrupts. Then provide a summary with best kept result.`,
    '',
    'Hard guardrail:',
    hasAutoresearchSh
      ? `- ${AUTORESEARCH_SH} exists. Use it as the benchmark entry point (do not replace with arbitrary custom benchmark commands).`
      : '- Prefer a single stable benchmark command. If you create autoresearch.sh, use it consistently for the rest of the loop.',
    '',
    resumeContext ? `Resume context:\n${resumeContext}` : 'No prior session context found; initialize a fresh session.',
  ]
  return sections.join('\n')
}

async function collectResumeContext(workDir: string): Promise<string> {
  const chunks: string[] = []
  const mdPath = join(workDir, AUTORESEARCH_MD)
  const ideasPath = join(workDir, AUTORESEARCH_IDEAS)
  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)

  if (await exists(mdPath)) {
    const md = await readFile(mdPath, 'utf-8')
    const trimmed = md.trim()
    if (trimmed) {
      chunks.push(`[${AUTORESEARCH_MD}]\n${trimmed.slice(-5000)}`)
    }
  }

  if (await exists(ideasPath)) {
    const ideas = await readFile(ideasPath, 'utf-8')
    const trimmed = ideas.trim()
    if (trimmed) {
      chunks.push(`[${AUTORESEARCH_IDEAS}]\n${trimmed.slice(-2000)}`)
    }
  }

  if (await exists(jsonlPath)) {
    const summary = await parseSessionSummary(workDir)
    const statLine = `runs=${summary.totalRuns}, keep=${summary.keep}, discard=${summary.discard}, crash=${summary.crash}, checks_failed=${summary.checksFailed}`
    chunks.push(`[${AUTORESEARCH_JSONL} summary]\n${statLine}`)
  }

  return chunks.join('\n\n')
}

async function appendJsonlRecord(workDir: string, record: Record<string, unknown>): Promise<void> {
  const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
  let current = ''
  if (await exists(jsonlPath)) {
    current = await readFile(jsonlPath, 'utf-8')
  }
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await writeFile(jsonlPath, `${current}${prefix}${JSON.stringify(record)}\n`, 'utf-8')
}

async function handleInitExperiment(
  input: Input,
  cwd: string,
  workDir: string,
  maxIterations: number,
): Promise<Output> {
  if (!input.name || !input.metric_name || !input.direction) {
    return {
      success: false,
      mode: 'inactive',
      action: 'init_experiment',
      message: 'init_experiment requires name, metric_name, and direction.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const current = await readRuntime(cwd)
  const existingSegment = current?.experiment?.currentSegment ?? 0
  const autoStopNonKeepStreak =
    input.auto_stop_non_keep_streak ?? DEFAULT_AUTO_STOP_NON_KEEP_STREAK
  const experimentState: RuntimeExperimentState = {
    name: input.name,
    metricName: input.metric_name,
    metricUnit: input.metric_unit ?? '',
    direction: input.direction,
    maxIterations,
    runCount: 0,
    secondaryMetrics: [],
    currentSegment: existingSegment + 1,
    bestMetric: undefined,
    autoStopNonKeepStreak,
    currentNonKeepStreak: 0,
    stopReason: undefined,
    lastRun: undefined,
  }

  await appendJsonlRecord(workDir, {
    type: 'config',
    timestamp: Date.now(),
    segment: experimentState.currentSegment,
    name: experimentState.name,
    metricName: experimentState.metricName,
    metricUnit: experimentState.metricUnit,
    direction: experimentState.direction,
    maxIterations: experimentState.maxIterations,
    autoStopNonKeepStreak: experimentState.autoStopNonKeepStreak,
  })

  await writeRuntime(cwd, {
    mode: 'active',
    workDir,
    goal: input.goal ?? current?.goal,
    updatedAt: nowIso(),
    experiment: experimentState,
  })

  return {
    success: true,
    mode: 'active',
    action: 'init_experiment',
    message: `Initialized experiment "${experimentState.name}" (metric=${experimentState.metricName}, ${experimentState.direction} is better, auto-stop non-keep streak=${experimentState.autoStopNonKeepStreak}).`,
    session: await buildSessionSnapshot(cwd, workDir),
  }
}

async function handleRunExperiment(
  input: Input,
  cwd: string,
  workDir: string,
  contextAbortSignal: AbortSignal,
): Promise<Output> {
  const runtime = await readRuntime(cwd)
  if (!runtime?.experiment) {
    return {
      success: false,
      mode: runtime?.mode ?? 'inactive',
      action: 'run_experiment',
      message: 'run_experiment requires init_experiment first.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const exp = runtime.experiment
  if (exp.stopReason) {
    return {
      success: false,
      mode: 'inactive',
      action: 'run_experiment',
      message: `Experiment is stopped: ${exp.stopReason}. Re-run init_experiment to start a new segment.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (exp.runCount >= exp.maxIterations) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'run_experiment',
      message: `Maximum experiments reached (${exp.maxIterations}). Re-run init_experiment to start a new segment.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const hasAutoresearchSh = await exists(join(workDir, AUTORESEARCH_SH))
  const command = input.command ?? (hasAutoresearchSh ? `bash ${AUTORESEARCH_SH}` : '')
  if (!command) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'run_experiment',
      message: `No benchmark command provided. Set command or create ${AUTORESEARCH_SH}.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (hasAutoresearchSh && !isAutoresearchShCommand(command)) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'run_experiment',
      message: `${AUTORESEARCH_SH} exists; you must run it instead of a custom command.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const t0 = Date.now()
  const benchmark = await runBashCommand(workDir, command, contextAbortSignal, 30 * 60 * 1000)
  const durationSeconds = (Date.now() - t0) / 1000
  const parsedMetrics = parseMetricLines(benchmark.combined)
  const parsedPrimaryMetric = getPrimaryMetric(parsedMetrics, exp.metricName)
  const benchmarkPassed = benchmark.code === 0 && !benchmark.interrupted

  let checksPass: boolean | null = null
  let checksTimedOut = false
  let checksOutputTail = ''
  const checksPath = join(workDir, AUTORESEARCH_CHECKS)
  if (benchmarkPassed && (await exists(checksPath))) {
    const timeoutSec = input.checks_timeout_seconds ?? 300
    const checks = await runBashCommand(
      workDir,
      `bash ${AUTORESEARCH_CHECKS}`,
      contextAbortSignal,
      timeoutSec * 1000,
    )
    checksTimedOut = checks.interrupted
    checksPass = checks.code === 0 && !checks.interrupted
    checksOutputTail = tailLines(checks.combined, 80)
  }

  const outputTail = tailLines(benchmark.combined, 120)
  const nextRuntime: RuntimeState = {
    ...runtime,
    mode: 'active',
    workDir,
    updatedAt: nowIso(),
    experiment: {
      ...exp,
      lastRun: {
        command,
        benchmarkPassed,
        durationSeconds,
        outputTail,
        parsedPrimaryMetric,
        parsedMetrics,
        checksPass,
        checksTimedOut,
        checksOutputTail,
      },
    },
  }
  await writeRuntime(cwd, nextRuntime)

  let message = `run_experiment finished in ${durationSeconds.toFixed(2)}s (exit=${benchmark.code}).`
  if (!benchmarkPassed) {
    message += `\nBenchmark failed. Next: log_experiment with status="crash".`
  } else if (checksPass === false || checksTimedOut) {
    message += `\nChecks failed or timed out. Next: log_experiment with status="checks_failed".`
  } else {
    message += `\nBenchmark passed. Next: log_experiment with status keep/discard.`
  }
  if (typeof parsedPrimaryMetric === 'number') {
    message += `\nParsed primary metric (${exp.metricName}) = ${parsedPrimaryMetric}`
  } else {
    message += `\nNo METRIC line found for ${exp.metricName}. Provide metric manually in log_experiment.`
  }
  if (Object.keys(parsedMetrics).length > 0) {
    message += `\nParsed metrics: ${JSON.stringify(parsedMetrics)}`
  }
  if (outputTail) {
    message += `\n\nLast output lines:\n${outputTail}`
  }
  if (checksOutputTail) {
    message += `\n\nLast checks output lines:\n${checksOutputTail}`
  }

  return {
    success: benchmarkPassed,
    mode: 'active',
    action: 'run_experiment',
    message,
    session: await buildSessionSnapshot(cwd, workDir),
  }
}

function metricImproved(direction: MetricDirection, baseline: number, current: number): boolean {
  return direction === 'lower' ? current < baseline : current > baseline
}

async function handleLogExperiment(
  input: Input,
  cwd: string,
  workDir: string,
  contextAbortSignal: AbortSignal,
): Promise<Output> {
  const runtime = await readRuntime(cwd)
  if (!runtime?.experiment) {
    return {
      success: false,
      mode: runtime?.mode ?? 'inactive',
      action: 'log_experiment',
      message: 'log_experiment requires init_experiment first.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  const exp = runtime.experiment
  if (exp.stopReason) {
    return {
      success: false,
      mode: 'inactive',
      action: 'log_experiment',
      message: `Experiment is stopped: ${exp.stopReason}. Re-run init_experiment to start a new segment.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  const lastRun = exp.lastRun
  if (!lastRun) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'log_experiment requires run_experiment immediately before it.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (!input.status || !input.description) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'log_experiment requires status and description.',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const status = input.status as ExperimentStatus
  if (!lastRun.benchmarkPassed && status !== 'crash') {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'Previous benchmark failed; status must be "crash".',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }
  if (status === 'keep' && (lastRun.checksPass === false || lastRun.checksTimedOut)) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: 'Cannot keep because checks failed/timed out; use status="checks_failed".',
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const primaryMetric = input.metric_value ?? lastRun.parsedPrimaryMetric
  if (typeof primaryMetric !== 'number' || !Number.isFinite(primaryMetric)) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: `Missing primary metric for log_experiment. Provide metric or emit METRIC ${exp.metricName}=... in benchmark output.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  const mergedSecondaryMetrics: Record<string, number> = {
    ...Object.fromEntries(
      Object.entries(lastRun.parsedMetrics).filter(([k]) => k !== exp.metricName),
    ),
    ...(input.metrics ?? {}),
  }
  const knownSet = new Set(exp.secondaryMetrics)
  if (knownSet.size > 0) {
    const missing = [...knownSet].filter(k => !(k in mergedSecondaryMetrics))
    if (missing.length > 0) {
      return {
        success: false,
        mode: runtime.mode,
        action: 'log_experiment',
        message: `Missing secondary metrics: ${missing.join(', ')}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }
  }
  const newMetricNames = Object.keys(mergedSecondaryMetrics).filter(k => !knownSet.has(k))
  if (newMetricNames.length > 0 && !input.force && knownSet.size > 0) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: `New secondary metrics not tracked before: ${newMetricNames.join(', ')}. Re-run with force=true to accept.`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  // keep only when it improves segment-local best metric
  if (
    status === 'keep' &&
    typeof exp.bestMetric === 'number' &&
    !metricImproved(exp.direction, exp.bestMetric, primaryMetric)
  ) {
    return {
      success: false,
      mode: runtime.mode,
      action: 'log_experiment',
      message: `status=keep rejected: metric did not improve vs segment best (${exp.bestMetric}).`,
      session: await buildSessionSnapshot(cwd, workDir),
    }
  }

  let gitNote = ''
  if (status === 'keep') {
    try {
      await runBashCommand(workDir, 'git add -A', contextAbortSignal, 10_000)
      const cachedDiff = await runBashCommand(
        workDir,
        'git diff --cached --quiet',
        contextAbortSignal,
        10_000,
      )
      if (cachedDiff.code === 0) {
        gitNote = 'nothing to commit'
      } else {
        const commitPayload = JSON.stringify({
          status,
          [exp.metricName]: primaryMetric,
          ...mergedSecondaryMetrics,
        })
        const commitMsg = `${input.description}\n\nResult: ${commitPayload}`
        const commit = await runBashCommand(
          workDir,
          `git commit -m ${shQuote(commitMsg)}`,
          contextAbortSignal,
          15_000,
        )
        gitNote = commit.code === 0 ? 'committed' : `commit failed (exit=${commit.code})`
      }
    } catch (error) {
      gitNote = `commit error: ${jsonErrorMessage(error)}`
    }
  } else {
    try {
      const excludes = [
        AUTORESEARCH_JSONL,
        AUTORESEARCH_MD,
        AUTORESEARCH_IDEAS,
        AUTORESEARCH_SH,
        AUTORESEARCH_CHECKS,
      ]
      const restoreCmd =
        'git restore --worktree --staged -- . ' +
        excludes.map(file => shQuote(`:(exclude)${file}`)).join(' ')
      await runBashCommand(workDir, restoreCmd, contextAbortSignal, 10_000)
      gitNote = `reverted (${status})`
    } catch (error) {
      gitNote = `revert error: ${jsonErrorMessage(error)}`
    }
  }

  const runNumber = exp.runCount + 1
  await appendJsonlRecord(workDir, {
    type: 'run',
    run: runNumber,
    segment: exp.currentSegment,
    timestamp: Date.now(),
    status,
    metric: primaryMetric,
    metricName: exp.metricName,
    metrics: mergedSecondaryMetrics,
    description: input.description,
    durationSeconds: lastRun.durationSeconds,
    command: lastRun.command,
    checksPass: lastRun.checksPass,
    checksTimedOut: lastRun.checksTimedOut,
    asi: input.asi,
  })

  const nextNonKeepStreak = status === 'keep' ? 0 : exp.currentNonKeepStreak + 1
  const autoStoppedByNonKeep =
    nextNonKeepStreak >= exp.autoStopNonKeepStreak
  const stopReason = autoStoppedByNonKeep
    ? `auto-stop: ${nextNonKeepStreak} consecutive non-keep results (limit=${exp.autoStopNonKeepStreak})`
    : undefined

  const nextExperiment: RuntimeExperimentState = {
    ...exp,
    runCount: runNumber,
    secondaryMetrics: [...new Set([...exp.secondaryMetrics, ...Object.keys(mergedSecondaryMetrics)])],
    bestMetric:
      status === 'keep'
        ? typeof exp.bestMetric === 'number'
          ? exp.direction === 'lower'
            ? Math.min(exp.bestMetric, primaryMetric)
            : Math.max(exp.bestMetric, primaryMetric)
          : primaryMetric
        : exp.bestMetric,
    currentNonKeepStreak: nextNonKeepStreak,
    stopReason,
    lastRun: undefined,
  }
  await writeRuntime(cwd, {
    ...runtime,
    mode:
      nextExperiment.runCount >= nextExperiment.maxIterations || autoStoppedByNonKeep
        ? 'inactive'
        : 'active',
    updatedAt: nowIso(),
    experiment: nextExperiment,
  })

  const finishedByLimit = nextExperiment.runCount >= nextExperiment.maxIterations
  return {
    success: true,
    mode: finishedByLimit || autoStoppedByNonKeep ? 'inactive' : 'active',
    action: 'log_experiment',
    message: `Logged run #${runNumber} as ${status}. Git: ${gitNote}. Non-keep streak=${nextNonKeepStreak}/${exp.autoStopNonKeepStreak}.${finishedByLimit ? ` Reached maxIterations=${nextExperiment.maxIterations}.` : ''}${autoStoppedByNonKeep ? ` ${stopReason}.` : ''}`,
    session: await buildSessionSnapshot(cwd, workDir),
  }
}

export const AutoresearchTool = buildTool({
  name: 'autoresearch',
  searchHint: 'autonomous research optimization loop',
  maxResultSizeChars: 100_000,
  userFacingName,
  async description() {
    return 'Run a session-based autonomous optimization loop with a strong state machine: init_experiment -> run_experiment -> log_experiment.'
  },
  async prompt() {
    return 'Autoresearch tool: supports action=start|status|off|clear|init_experiment|run_experiment|log_experiment. Preferred protocol is strict: init_experiment once, run_experiment, then log_experiment every time. checks_failed cannot be kept; discard/crash/checks_failed auto-revert non-autoresearch changes.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const safeOutput =
      output && typeof output === 'object'
        ? (output as Partial<Output>)
        : undefined
    const content =
      typeof safeOutput?.message === 'string'
        ? safeOutput.message
        : 'Autoresearch failed before producing a structured result.'
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
      is_error: safeOutput?.success !== true,
    }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, context, canUseTool, parentMessage, onProgress) {
    const action: AutoresearchAction = input.action ?? 'start'
    const resolved = await resolveWorkingDir(input)
    if (!resolved.ok) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Autoresearch failed: ${resolved.error}`,
      }
    }
    const { cwd, workDir, maxIterations } = resolved

    if (action === 'init_experiment') {
      return await handleInitExperiment(input, cwd, workDir, maxIterations)
    }

    if (action === 'run_experiment') {
      return await handleRunExperiment(
        input,
        cwd,
        workDir,
        context.abortController.signal,
      )
    }

    if (action === 'log_experiment') {
      return await handleLogExperiment(
        input,
        cwd,
        workDir,
        context.abortController.signal,
      )
    }

    if (action === 'status') {
      const runtime = await readRuntime(cwd)
      const message = await buildStatusMessage(cwd, workDir)
      const session = await buildSessionSnapshot(cwd, workDir)
      return {
        success: true,
        mode: runtime?.mode ?? 'inactive',
        action,
        message,
        session,
      }
    }

    if (action === 'off') {
      const current = await readRuntime(cwd)
      await writeRuntime(cwd, {
        mode: 'inactive',
        workDir,
        goal: current?.goal ?? input.goal,
        updatedAt: nowIso(),
      })
      return {
        success: true,
        mode: 'inactive',
        action,
        message: `Autoresearch mode OFF.\nWork dir: ${workDir}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }

    if (action === 'clear') {
      const jsonlPath = join(workDir, AUTORESEARCH_JSONL)
      if (await exists(jsonlPath)) {
        await rm(jsonlPath, { force: true })
      }
      await writeRuntime(cwd, {
        mode: 'inactive',
        workDir,
        goal: input.goal,
        updatedAt: nowIso(),
      })
      return {
        success: true,
        mode: 'inactive',
        action,
        message: `Cleared ${AUTORESEARCH_JSONL} and turned autoresearch mode OFF.\nWork dir: ${workDir}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }

    const shouldResume = input.resume ?? true
    const hasMd = await exists(join(workDir, AUTORESEARCH_MD))
    const runtimeBeforeStart = await readRuntime(cwd)
    if (!input.goal && !runtimeBeforeStart?.experiment && !(shouldResume && hasMd)) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `action=start requires goal when no ${AUTORESEARCH_MD} exists for resume.\nWork dir: ${workDir}`,
      }
    }
    if (runtimeBeforeStart?.experiment?.stopReason) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Autoresearch start blocked: ${runtimeBeforeStart.experiment.stopReason}\nRun init_experiment to start a new segment.`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }

    const seeded = await maybeSeedAutoresearchMd(workDir, input, maxIterations)
    const [resumeContext, hasAutoresearchSh, hasChecks] = await Promise.all([
      shouldResume ? collectResumeContext(workDir) : Promise.resolve(''),
      exists(join(workDir, AUTORESEARCH_SH)),
      exists(join(workDir, AUTORESEARCH_CHECKS)),
    ])
    const effectiveName =
      runtimeBeforeStart?.experiment?.name ??
      input.name ??
      input.goal ??
      'Autoresearch Session'
    const effectiveMetricName =
      runtimeBeforeStart?.experiment?.metricName ??
      input.metric_name ??
      input.metric ??
      'metric'
    const effectiveDirection =
      runtimeBeforeStart?.experiment?.direction ?? input.direction ?? 'lower'
    const effectiveMetricUnit =
      runtimeBeforeStart?.experiment?.metricUnit ?? input.metric_unit ?? ''

    let bootstrapNote = ''
    if (!runtimeBeforeStart?.experiment) {
      const initResult = await handleInitExperiment(
        {
          ...input,
          action: 'init_experiment',
          name: effectiveName,
          metric_name: effectiveMetricName,
          metric_unit: effectiveMetricUnit,
          direction: effectiveDirection,
        },
        cwd,
        workDir,
        maxIterations,
      )
      if (!initResult.success) {
        return {
          ...initResult,
          action: 'start',
        }
      }
      bootstrapNote = `${initResult.message}\n`
    }

    const strictProtocolPrompt = [
      'You are in protocol-first AUTORESEARCH mode.',
      'You MUST use ONLY autoresearch actions: run_experiment and log_experiment (init_experiment already handled unless you are explicitly resetting segment).',
      '',
      'Loop requirements:',
      `- Work directory: ${workDir}`,
      `- Max iterations: ${maxIterations}`,
      `- Auto-stop non-keep streak: ${runtimeBeforeStart?.experiment?.autoStopNonKeepStreak ?? input.auto_stop_non_keep_streak ?? DEFAULT_AUTO_STOP_NON_KEEP_STREAK}`,
      `- Primary metric: ${effectiveMetricName}`,
      `- Direction: ${effectiveDirection}`,
      `- Scope: ${input.scope ?? '(not constrained)'}`,
      `- Benchmark command: ${input.command ?? input.verify ?? (hasAutoresearchSh ? `bash ${AUTORESEARCH_SH}` : '(provide command in run_experiment)')}`,
      `- Guard command: ${input.guard ?? (hasChecks ? `bash ${AUTORESEARCH_CHECKS}` : '(none)')}`,
      '',
      'For each iteration:',
      '1) Make one small code change hypothesis.',
      '2) Call autoresearch with action="run_experiment".',
      '3) Immediately call autoresearch with action="log_experiment".',
      '4) Status policy:',
      '- benchmark failed => crash',
      '- checks failed/timed out => checks_failed (never keep)',
      '- benchmark passed + improved primary metric => keep',
      '- otherwise => discard',
      '',
      'Do not manually run git commit/revert; log_experiment enforces it.',
      'Stop when max iterations reached or no promising hypotheses remain.',
      `Hard stop: if consecutive non-keep results reaches configured limit, the tool will auto-stop and reject further runs until init_experiment is called again.`,
      '',
      resumeContext ? `Resume context:\n${resumeContext}` : 'No prior session context found.',
    ].join('\n')
    const userMessage = createUserMessage(strictProtocolPrompt)
    const agentMessages: Message[] = []
    const currentRuntime = await readRuntime(cwd)

    await writeRuntime(cwd, {
      mode: 'active',
      workDir,
      goal: input.goal ?? currentRuntime?.goal,
      updatedAt: nowIso(),
      experiment: currentRuntime?.experiment,
    })

    try {
      for await (const message of runAgent({
        agentDefinition: GENERAL_PURPOSE_AGENT,
        promptMessages: [userMessage],
        toolUseContext: context,
        canUseTool,
        isAsync: false,
        querySource: 'agent:custom',
        model: undefined,
        availableTools: context.options.tools,
        override: { agentId: `autoresearch-${Date.now()}` },
      })) {
        agentMessages.push(message)

        // Report progress if needed
        if (onProgress && (message.type === 'assistant' || message.type === 'user')) {
          onProgress({
            toolUseID: `autoresearch_${parentMessage?.message.id || 'unknown'}`,
            data: {
              message,
              type: 'autoresearch_progress',
              iteration: agentMessages.length,
            } satisfies AutoresearchProgress,
          })
        }
      }

      let resultText = ''
      for (const msg of agentMessages) {
        if (msg.type === 'assistant' && msg.message.content) {
          const content = msg.message.content
          if (typeof content === 'string') {
            resultText += content
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                resultText += block.text
              }
            }
          }
        }
      }

      if (!resultText.trim()) {
        resultText = 'Autoresearch completed but no summary was provided by the agent.'
      }

      const postSummary = await parseSessionSummary(workDir)
      const summaryTail = `\n\nSession stats: runs=${postSummary.totalRuns}, keep=${postSummary.keep}, discard=${postSummary.discard}, crash=${postSummary.crash}, checks_failed=${postSummary.checksFailed}`
      const seedNote = seeded ? `\nInitialized ${AUTORESEARCH_MD}.` : ''

      return {
        success: true,
        mode: 'active',
        action,
        message: `Autoresearch loop completed.${seedNote}\n${bootstrapNote}Work dir: ${workDir}\n\nResults:\n${resultText}${summaryTail}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    } catch (error) {
      await writeRuntime(cwd, {
        mode: 'inactive',
        workDir,
        goal: input.goal,
        updatedAt: nowIso(),
      })
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Autoresearch failed: ${error instanceof Error ? error.message : String(error)}\nWork dir: ${workDir}`,
        session: await buildSessionSnapshot(cwd, workDir),
      }
    }
  },
})
