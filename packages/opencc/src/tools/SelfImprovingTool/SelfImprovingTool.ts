import { access, appendFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { MemoryStore } from '../MemoryTool/MemoryStore.js'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'
import { getAutoMemPath } from '../../memdir/paths.js'

const SELF_IMPROVING_TOOL_NAME = 'learn-tool'

const DESCRIPTION =
  'Self-improving system tool. Initializes observability files, records tool execution performance, analyzes trends, applies PID-style parameter suggestions, predicts degradation, and logs learnings/errors/feature requests.'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'monitor',
        'record',
        'analyze',
        'adjust',
        'predict',
        'report',
        'learn',
        'ingest_memory',
        'promote_memory',
      ])
      .describe(
        'monitor initializes self-improving workspace; record logs one execution sample; analyze summarizes historical metrics; adjust generates PID-based parameter adjustments; predict forecasts performance; report returns recommendations; learn logs a learning/error/feature request entry; ingest_memory converts memory markdown docs into structured learnings; promote_memory promotes validated learnings into long-term memory.',
      ),
    toolName: z
      .string()
      .optional()
      .describe('Optional tool name to focus on (e.g., Bash, se-tool).'),
    metric: z
      .enum(['execution_time', 'success_rate'])
      .optional()
      .describe('Primary metric used by analyze/adjust/predict. Default: execution_time.'),
    targetValue: z
      .number()
      .optional()
      .describe('Target metric value. For execution_time lower is better, for success_rate higher is better.'),
    predictionHorizon: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Future steps to forecast (default: 5).'),

    executionTimeMs: z
      .number()
      .nonnegative()
      .optional()
      .describe('Used by action=record: observed execution time in ms.'),
    success: z
      .boolean()
      .optional()
      .describe('Used by action=record: whether the tool execution succeeded.'),
    error: z
      .string()
      .optional()
      .describe('Used by action=record: error summary if failed.'),
    sourceAction: z
      .string()
      .optional()
      .describe('Used by action=record: action/sub-action name that was executed.'),

    learningType: z
      .enum([
        'correction',
        'insight',
        'knowledge_gap',
        'best_practice',
        'error',
        'feature_request',
      ])
      .optional()
      .describe('Used by action=learn.'),
    title: z.string().optional().describe('Used by action=learn: one-line title.'),
    details: z
      .string()
      .optional()
      .describe('Used by action=learn: detailed context and suggested action.'),
    priority: z
      .enum(['low', 'medium', 'high', 'critical'])
      .optional()
      .describe('Used by action=learn. Default: medium.'),
    memoryFilePaths: z
      .array(z.string())
      .optional()
      .describe('Used by action=ingest_memory: markdown file paths to ingest.'),
    topic: z
      .string()
      .optional()
      .describe('Used by action=ingest_memory: topic filter (default: cdp).'),
    sourceFilePath: z
      .string()
      .optional()
      .describe(
        'Used by action=promote_memory: source markdown path (default: .learnings/LEARNINGS.md).',
      ),
    onlyVerified: z
      .boolean()
      .optional()
      .describe(
        'Used by action=promote_memory: only promote entries marked as validated/effective (default: true).',
      ),
    maxEntries: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Used by action=promote_memory: max promoted entries (default: 30).'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Used by action=promote_memory: preview promotions without writing memory files.'),
    memoryType: z
      .enum(MEMORY_TYPES)
      .optional()
      .describe('Used by action=promote_memory: memory type to save (default: feedback).'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

type Trend = 'improving' | 'stable' | 'degrading'

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.enum([
      'monitor',
      'record',
      'analyze',
      'adjust',
      'predict',
      'report',
      'learn',
      'ingest_memory',
      'promote_memory',
    ]),
    summary: z.string(),
    projectRoot: z.string(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    adjustments: z
      .array(
        z.object({
          tool: z.string(),
          parameter: z.string(),
          oldValue: z.number(),
          newValue: z.number(),
          reason: z.string(),
        }),
      )
      .optional(),
    predictions: z
      .array(
        z.object({
          tool: z.string(),
          metric: z.enum(['execution_time', 'success_rate']),
          currentValue: z.number(),
          predictedValue: z.number(),
          confidence: z.number(),
          trend: z.enum(['improving', 'stable', 'degrading']),
        }),
      )
      .optional(),
    recommendations: z.array(z.string()).optional(),
    filesCreated: z.array(z.string()).optional(),
    loggedEntryId: z.string().optional(),
    importedCount: z.number().optional(),
    promotedCount: z.number().optional(),
    skippedCount: z.number().optional(),
    dryRunPreview: z.array(z.string()).optional(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const PERFORMANCE_DATA_FILE = '.self_improving_performance.json'
const ADJUSTMENTS_LOG_FILE = '.self_improving_adjustments.log'
const LEARNINGS_DIR = '.learnings'
const LEARNINGS_FILE = 'LEARNINGS.md'
const ERRORS_FILE = 'ERRORS.md'
const FEATURES_FILE = 'FEATURE_REQUESTS.md'

type LearningKind = NonNullable<Input['learningType']>

interface PerformanceRecord {
  timestamp: string
  toolName: string
  action: string
  executionTimeMs: number
  success: boolean
  error?: string
}

interface LearningEntry {
  id: string
  title: string
  body: string
  status: string
  summary: string
  details: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function nowISO(): string {
  return new Date().toISOString()
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

function fingerprint(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function getLearnToolRoot(): string {
  return join(getAutoMemPath(), '..', 'learn-tool')
}

function getDefaultMemoryDir(): string {
  return getAutoMemPath()
}

function nextId(prefix: 'LRN' | 'ERR' | 'FEAT', existing: string, iso: string): string {
  const datePart = yyyymmdd(iso)
  const matches = existing.match(new RegExp(`\\[${prefix}-${datePart}-(\\d{3})\\]`, 'g')) ?? []
  const seq = String(matches.length + 1).padStart(3, '0')
  return `${prefix}-${datePart}-${seq}`
}

function calculateTrend(values: number[]): number {
  if (values.length < 2) return 0
  const n = values.length
  const xs = Array.from({ length: n }, (_, i) => i)
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = values.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * values[i], 0)
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)
  const den = n * sumX2 - sumX * sumX
  return den === 0 ? 0 : (n * sumXY - sumX * sumY) / den
}

function classifyTrend(slope: number, metric: 'execution_time' | 'success_rate'): Trend {
  const threshold = metric === 'execution_time' ? 0.1 : 0.005
  if (Math.abs(slope) <= threshold) return 'stable'
  if (metric === 'execution_time') return slope > 0 ? 'degrading' : 'improving'
  return slope > 0 ? 'improving' : 'degrading'
}

class PIDController {
  private integral = 0
  private lastError = 0

  constructor(
    private readonly kp: number,
    private readonly ki: number,
    private readonly kd: number,
    private readonly setpoint: number,
  ) {}

  update(measurement: number, dtSec = 1): number {
    const error = this.setpoint - measurement
    this.integral += error * dtSec
    const derivative = (error - this.lastError) / dtSec
    this.lastError = error
    return this.kp * error + this.ki * this.integral + this.kd * derivative
  }
}

async function loadPerformanceData(projectRoot: string): Promise<PerformanceRecord[]> {
  const dataPath = join(projectRoot, PERFORMANCE_DATA_FILE)
  if (!(await exists(dataPath))) return []
  try {
    const content = await readFile(dataPath, 'utf-8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? (parsed as PerformanceRecord[]) : []
  } catch {
    return []
  }
}

async function savePerformanceData(projectRoot: string, data: PerformanceRecord[]): Promise<void> {
  await writeFile(join(projectRoot, PERFORMANCE_DATA_FILE), JSON.stringify(data, null, 2), 'utf-8')
}

async function logAdjustment(projectRoot: string, adj: Output['adjustments'][number]): Promise<void> {
  const line = `${nowISO()} ${JSON.stringify(adj)}\n`
  await appendFile(join(projectRoot, ADJUSTMENTS_LOG_FILE), line, 'utf-8')
}

async function ensureLearningFiles(projectRoot: string): Promise<string[]> {
  const created: string[] = []
  const dirPath = join(projectRoot, LEARNINGS_DIR)
  if (!(await exists(dirPath))) {
    await mkdir(dirPath, { recursive: true })
    created.push(LEARNINGS_DIR)
  }

  const files: Array<{ name: string; header: string }> = [
    {
      name: LEARNINGS_FILE,
      header:
        '# Learnings\n\nCorrections, insights, and knowledge gaps captured during development.\n\n**Categories**: correction | insight | knowledge_gap | best_practice\n\n---\n',
    },
    { name: ERRORS_FILE, header: '# Errors\n\nCommand failures and integration errors.\n\n---\n' },
    { name: FEATURES_FILE, header: '# Feature Requests\n\nCapabilities requested by the user.\n\n---\n' },
  ]

  for (const item of files) {
    const full = join(dirPath, item.name)
    if (!(await exists(full))) {
      await writeFile(full, item.header, 'utf-8')
      created.push(join(LEARNINGS_DIR, item.name))
    }
  }

  return created
}

async function runMonitor(projectRoot: string): Promise<Output> {
  const created = await ensureLearningFiles(projectRoot)

  const perfPath = join(projectRoot, PERFORMANCE_DATA_FILE)
  if (!(await exists(perfPath))) {
    await writeFile(perfPath, '[]\n', 'utf-8')
    created.push(PERFORMANCE_DATA_FILE)
  }

  const adjPath = join(projectRoot, ADJUSTMENTS_LOG_FILE)
  if (!(await exists(adjPath))) {
    await writeFile(adjPath, '', 'utf-8')
    created.push(ADJUSTMENTS_LOG_FILE)
  }

  return {
    success: true,
    action: 'monitor',
    projectRoot,
    summary:
      created.length > 0
        ? `Self-improving workspace initialized. Created: ${created.join(', ')}`
        : 'Self-improving workspace already initialized.',
    filesCreated: created,
  }
}

async function runRecord(projectRoot: string, input: Input): Promise<Output> {
  if (!input.toolName) {
    return {
      success: false,
      action: 'record',
      projectRoot,
      summary: 'action=record requires toolName.',
    }
  }
  if (typeof input.executionTimeMs !== 'number' || typeof input.success !== 'boolean') {
    return {
      success: false,
      action: 'record',
      projectRoot,
      summary: 'action=record requires executionTimeMs and success.',
    }
  }

  const data = await loadPerformanceData(projectRoot)
  const rec: PerformanceRecord = {
    timestamp: nowISO(),
    toolName: input.toolName,
    action: input.sourceAction || 'call',
    executionTimeMs: input.executionTimeMs,
    success: input.success,
    error: input.error,
  }
  data.push(rec)
  await savePerformanceData(projectRoot, data)

  return {
    success: true,
    action: 'record',
    projectRoot,
    summary: `Recorded performance sample for ${input.toolName}.`,
    metrics: {
      totalRecords: data.length,
      lastRecord: rec,
    },
  }
}

function buildMetrics(data: PerformanceRecord[], toolName?: string): Record<string, unknown> {
  const scoped = toolName ? data.filter(r => r.toolName === toolName) : data
  const tools = [...new Set(scoped.map(r => r.toolName))]
  const out: Record<string, unknown> = {}

  for (const t of tools) {
    const rows = scoped.filter(r => r.toolName === t)
    const totalCalls = rows.length
    const successCount = rows.filter(r => r.success).length
    const successRate = totalCalls === 0 ? 0 : successCount / totalCalls
    const exec = rows.map(r => r.executionTimeMs)
    const avgExecutionTime = exec.reduce((a, b) => a + b, 0) / Math.max(exec.length, 1)
    const trendSlope = calculateTrend(exec.slice(-10))

    out[t] = {
      totalCalls,
      successRate,
      avgExecutionTime,
      lastExecutionTime: exec[exec.length - 1] ?? 0,
      trendSlope,
      trend: classifyTrend(trendSlope, 'execution_time'),
    }
  }

  return out
}

async function runAnalyze(projectRoot: string, toolName?: string): Promise<Output> {
  const data = await loadPerformanceData(projectRoot)
  const scoped = toolName ? data.filter(r => r.toolName === toolName) : data
  if (scoped.length === 0) {
    return {
      success: false,
      action: 'analyze',
      projectRoot,
      summary: toolName
        ? `No performance data found for ${toolName}.`
        : 'No performance data found.',
    }
  }

  return {
    success: true,
    action: 'analyze',
    projectRoot,
    summary: `Analyzed ${scoped.length} records${toolName ? ` for ${toolName}` : ''}.`,
    metrics: buildMetrics(data, toolName),
  }
}

async function runAdjust(
  projectRoot: string,
  toolName?: string,
  metric: 'execution_time' | 'success_rate' = 'execution_time',
  targetValue?: number,
): Promise<Output> {
  const data = await loadPerformanceData(projectRoot)
  const scoped = toolName ? data.filter(r => r.toolName === toolName) : data
  if (scoped.length === 0) {
    return {
      success: false,
      action: 'adjust',
      projectRoot,
      summary: 'No performance data available to adjust.',
    }
  }

  if (metric !== 'execution_time') {
    return {
      success: false,
      action: 'adjust',
      projectRoot,
      summary: 'PID adjustment currently supports metric=execution_time only.',
    }
  }

  const tools = toolName ? [toolName] : [...new Set(scoped.map(r => r.toolName))]
  const adjustments: NonNullable<Output['adjustments']> = []

  for (const t of tools) {
    const rows = scoped.filter(r => r.toolName === t)
    const exec = rows.map(r => r.executionTimeMs)
    if (exec.length < 2) continue

    const last = exec[exec.length - 1]
    const avg = exec.reduce((a, b) => a + b, 0) / exec.length
    const setpoint = targetValue ?? Math.max(50, avg * 0.9)

    const pid = new PIDController(0.6, 0.05, 0.1, setpoint)
    const control = pid.update(avg)

    const oldTimeout = Math.max(100, Math.round(last))
    const newTimeout = Math.max(100, Math.round(oldTimeout + Math.abs(control)))

    const adj = {
      tool: t,
      parameter: 'timeout_ms',
      oldValue: oldTimeout,
      newValue: newTimeout,
      reason: `avg=${avg.toFixed(1)}ms target=${setpoint.toFixed(1)}ms control=${control.toFixed(2)}`,
    }

    adjustments.push(adj)
    await logAdjustment(projectRoot, adj)
  }

  return {
    success: true,
    action: 'adjust',
    projectRoot,
    summary: `Generated ${adjustments.length} PID-based adjustment(s).`,
    adjustments,
  }
}

async function runPredict(
  projectRoot: string,
  toolName?: string,
  metric: 'execution_time' | 'success_rate' = 'execution_time',
  predictionHorizon = 5,
): Promise<Output> {
  const data = await loadPerformanceData(projectRoot)
  const scoped = toolName ? data.filter(r => r.toolName === toolName) : data
  if (scoped.length < 3) {
    return {
      success: false,
      action: 'predict',
      projectRoot,
      summary: 'Insufficient data for prediction (need at least 3 records).',
    }
  }

  const tools = toolName ? [toolName] : [...new Set(scoped.map(r => r.toolName))]
  const predictions: NonNullable<Output['predictions']> = []

  for (const t of tools) {
    const rows = scoped.filter(r => r.toolName === t)
    const series =
      metric === 'execution_time'
        ? rows.map(r => r.executionTimeMs)
        : rows.map(r => (r.success ? 1 : 0))
    if (series.length < 3) continue

    const slope = calculateTrend(series.slice(-10))
    const currentValue = series[series.length - 1]
    const predictedValue = currentValue + slope * predictionHorizon
    const trend = classifyTrend(slope, metric)

    predictions.push({
      tool: t,
      metric,
      currentValue,
      predictedValue,
      confidence: 0.7,
      trend,
    })
  }

  return {
    success: true,
    action: 'predict',
    projectRoot,
    summary: `Generated ${predictions.length} ${metric} prediction(s) for horizon=${predictionHorizon}.`,
    predictions,
  }
}

async function runReport(projectRoot: string): Promise<Output> {
  const data = await loadPerformanceData(projectRoot)
  if (data.length === 0) {
    return {
      success: false,
      action: 'report',
      projectRoot,
      summary: 'No performance data available for reporting.',
    }
  }

  const metrics = buildMetrics(data)
  const recommendations: string[] = []

  for (const [tool, raw] of Object.entries(metrics)) {
    const m = raw as {
      successRate: number
      avgExecutionTime: number
      trend: Trend
      totalCalls: number
    }

    if (m.totalCalls >= 5 && m.successRate < 0.8) {
      recommendations.push(
        `${tool}: success rate ${(m.successRate * 100).toFixed(1)}% is low; inspect .learnings/ERRORS.md and add remediation rules.`,
      )
    }

    if (m.trend === 'degrading') {
      recommendations.push(
        `${tool}: execution-time trend is degrading; run action=adjust with metric=execution_time.`,
      )
    }

    if (m.avgExecutionTime > 10_000) {
      recommendations.push(
        `${tool}: high average execution time (${m.avgExecutionTime.toFixed(0)}ms); consider breaking tasks into smaller tool calls.`,
      )
    }
  }

  return {
    success: true,
    action: 'report',
    projectRoot,
    summary: `Report generated from ${data.length} records across ${Object.keys(metrics).length} tool(s).`,
    metrics,
    recommendations,
  }
}

async function runLearn(projectRoot: string, input: Input): Promise<Output> {
  if (!input.learningType || !input.title || !input.details) {
    return {
      success: false,
      action: 'learn',
      projectRoot,
      summary: 'action=learn requires learningType, title, and details.',
    }
  }

  await ensureLearningFiles(projectRoot)

  const iso = nowISO()
  const prio = input.priority ?? 'medium'
  const area = 'tools'

  let targetFile = LEARNINGS_FILE
  let prefix: 'LRN' | 'ERR' | 'FEAT' = 'LRN'

  if (input.learningType === 'error') {
    targetFile = ERRORS_FILE
    prefix = 'ERR'
  } else if (input.learningType === 'feature_request') {
    targetFile = FEATURES_FILE
    prefix = 'FEAT'
  }

  const fullPath = join(projectRoot, LEARNINGS_DIR, targetFile)
  const existing = (await exists(fullPath)) ? await readFile(fullPath, 'utf-8') : ''
  const id = nextId(prefix, existing, iso)

  const entry = `\n## [${id}] ${input.title}\n\n**Logged**: ${iso}\n**Priority**: ${prio}\n**Status**: pending\n**Area**: ${area}\n\n### Summary\n${input.title}\n\n### Details\n${input.details}\n\n### Metadata\n- Source: learn-tool\n- Type: ${input.learningType}\n\n---\n`
  await appendFile(fullPath, entry, 'utf-8')

  return {
    success: true,
    action: 'learn',
    projectRoot,
    summary: `Logged ${input.learningType} entry to ${join(LEARNINGS_DIR, targetFile)}.`,
    loggedEntryId: id,
  }
}

function extractCandidatesFromMarkdown(content: string, topic: string): string[] {
  const lines = content.split('\n')
  const topicLc = topic.toLowerCase()
  const isHeading = (line: string) => /^\s*#{1,6}\s+/.test(line)
  const clean = (line: string) => line.trim()
  const isNegatedTopic = (line: string) => {
    const lc = line.toLowerCase()
    return (
      new RegExp(`\\b(no|not|without)\\s+${topicLc}\\b`).test(lc) ||
      new RegExp(`\\b${topicLc}\\s+(is\\s+)?(not|absent|none)\\b`).test(lc) ||
      new RegExp(`(无|没有)\\s*${topicLc}`).test(lc)
    )
  }

  // Strict topic extraction:
  // 1) find heading containing topic
  // 2) capture this heading block until next heading
  // 3) include bullets + short paragraphs for actionable details
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = clean(lines[i] ?? '')
    if (!line) {
      i += 1
      continue
    }

    if (isHeading(line) && line.toLowerCase().includes(topicLc) && !isNegatedTopic(line)) {
      out.push(line)
      i += 1

      while (i < lines.length) {
        const next = clean(lines[i] ?? '')
        if (!next) {
          i += 1
          continue
        }
        if (isHeading(next)) break

        // Keep markdown bullets/numbered steps/code-fence markers and
        // concise explanatory lines. This preserves detailed process steps.
        const keep =
          next.startsWith('- ') ||
          next.startsWith('* ') ||
          /^\d+\.\s/.test(next) ||
          next.startsWith('```') ||
          next.length <= 220

        if (keep) out.push(next)
        if (out.length >= 40) return out
        i += 1
      }
      // Continue scanning in case multiple topic sections exist in same file.
      continue
    }
    i += 1
  }

  // Secondary strict match: if no section heading hit, include only lines
  // explicitly containing topic (no generic fallback to unrelated headings).
  if (out.length === 0) {
    for (const raw of lines) {
      const line = clean(raw)
      if (!line) continue
      if (line.toLowerCase().includes(topicLc) && !isNegatedTopic(line)) {
        out.push(line)
      }
      if (out.length >= 20) break
    }
  }

  return out
}

async function fileLikelyMatchesTopic(path: string, topic: string): Promise<boolean> {
  const topicLc = topic.toLowerCase()
  try {
    // Cheap precheck: read head only.
    const content = await readFile(path, 'utf-8')
    const head = content.slice(0, 8000).toLowerCase()
    // Strong signal only: topic appears in a markdown heading,
    // or appears >=2 times without obvious negation pattern.
    const headingHit = new RegExp(`^\\s*#{1,6}\\s+.*${topicLc}.*$`, 'm').test(head)
    if (headingHit) return true

    const mentions = (head.match(new RegExp(topicLc, 'g')) ?? []).length
    const negated = new RegExp(`\\b(no|not|without)\\s+${topicLc}\\b`).test(head)
    return mentions >= 2 && !negated
  } catch {
    return false
  }
}

async function runIngestMemory(projectRoot: string, input: Input): Promise<Output> {
  const topic = (input.topic?.trim() || 'cdp').toLowerCase()
  let filePaths = input.memoryFilePaths ?? []
  let consideredCount = 0
  let skippedCount = 0

  // Default source: the same auto-memory directory used by MemoryTool.
  if (filePaths.length === 0) {
    const defaultMemoryDir = getDefaultMemoryDir()
    if (await exists(defaultMemoryDir)) {
      const entries = await readdir(defaultMemoryDir, { withFileTypes: true })
      const allMd = entries
        .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map(e => join(defaultMemoryDir, e.name))

      // Prevent cross-memory contamination: only import files that match topic.
      const matched: string[] = []
      for (const p of allMd) {
        consideredCount += 1
        if (await fileLikelyMatchesTopic(p, topic)) {
          matched.push(p)
        } else {
          skippedCount += 1
        }
      }
      filePaths = matched
    }
  }

  if (filePaths.length === 0) {
    return {
      success: false,
      action: 'ingest_memory',
      projectRoot,
      summary:
        'No memory markdown files found. Provide memoryFilePaths or ensure ~/.claude/projects/<project>/memory contains .md files.',
      importedCount: 0,
    }
  }

  await ensureLearningFiles(projectRoot)
  const learningsPath = join(projectRoot, LEARNINGS_DIR, LEARNINGS_FILE)
  const existing = (await exists(learningsPath))
    ? await readFile(learningsPath, 'utf-8')
    : ''
  const iso = nowISO()
  const datePart = yyyymmdd(iso)
  let seq =
    (existing.match(new RegExp(`\\[LRN-${datePart}-(\\d{3})\\]`, 'g')) ?? [])
      .length + 1

  let importedCount = 0

  for (const rawPath of filePaths) {
    if (input.memoryFilePaths && input.memoryFilePaths.length > 0) {
      consideredCount += 1
    }
    const fullPath = rawPath.startsWith('/') ? rawPath : join(projectRoot, rawPath)
    if (!(await exists(fullPath))) {
      skippedCount += 1
      continue
    }

    if (!(await fileLikelyMatchesTopic(fullPath, topic))) {
      skippedCount += 1
      continue
    }

    const content = await readFile(fullPath, 'utf-8')
    const candidates = extractCandidatesFromMarkdown(content, topic)
    if (candidates.length === 0) {
      skippedCount += 1
      continue
    }

    const id = `LRN-${datePart}-${String(seq).padStart(3, '0')}`
    seq += 1

    const details = candidates.map(line => `- ${line}`).join('\n')
    const sourceFingerprint = fingerprint(`${fullPath}\n${candidates.join('\n')}`)
    const entry = `\n## [${id}] Memory Ingest: ${topic.toUpperCase()} from ${fullPath}\n\n**Logged**: ${iso}\n**Priority**: medium\n**Status**: pending\n**Area**: tools\n\n### Summary\n从单个记忆文档提取 ${topic} 经验并转为可复用条目。\n\n### Details\n${details}\n\n### Metadata\n- Source: learn-tool ingest_memory\n- Topic: ${topic}\n- Related File: ${fullPath}\n- Source Fingerprint: ${sourceFingerprint}\n\n---\n`
    await appendFile(learningsPath, entry, 'utf-8')
    importedCount += 1
  }

  return {
    success: importedCount > 0,
    action: 'ingest_memory',
    projectRoot,
    summary:
      importedCount > 0
        ? `Imported ${importedCount} memory doc(s) for topic=${topic}; considered=${consideredCount}, skipped=${skippedCount}.`
        : `No valid memory docs imported for topic=${topic}; considered=${consideredCount}, skipped=${skippedCount}.`,
    importedCount,
  }
}

function parseLearningEntries(content: string): LearningEntry[] {
  const headingRegex = /^## \[([^\]]+)\]\s+(.+)$/gm
  const matches = Array.from(content.matchAll(headingRegex))
  if (matches.length === 0) return []

  const out: LearningEntry[] = []
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i]
    const next = matches[i + 1]
    const start = cur.index ?? 0
    const end = next?.index ?? content.length
    const block = content.slice(start, end).trim()
    const status = (block.match(/\*\*Status\*\*:\s*([^\n]+)/i)?.[1] ?? '').trim()
    const summary = (block.match(/### Summary\s*\n([\s\S]*?)\n### /i)?.[1] ?? '').trim()
    const details = (block.match(/### Details\s*\n([\s\S]*?)(\n### |\n---|$)/i)?.[1] ?? '').trim()

    out.push({
      id: (cur[1] ?? '').trim(),
      title: (cur[2] ?? '').trim(),
      body: block,
      status,
      summary,
      details,
    })
  }
  return out
}

function isVerifiedEffective(entry: LearningEntry): boolean {
  const text = `${entry.status}\n${entry.body}`.toLowerCase()
  const hasNegative =
    /(?:未验证|待验证|验证中|未生效|无效|invalid|unverified|pending)/i.test(text)
  if (hasNegative) return false
  return /(?:verified|validated|effective|accepted|adopted|stable|done|resolved|closed|已验证|验证通过|有效|已采用|已落地|稳定)/i.test(
    text,
  )
}

function normalizeTitle(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function hasDuplicateMemory(
  store: MemoryStore,
  memoryType: MemoryType,
  entry: LearningEntry,
): Promise<boolean> {
  const byId = await store.searchMemories(entry.id, memoryType, 10)
  if (byId.some(m => m.content.includes(`[${entry.id}]`))) return true

  const byTitle = await store.searchMemories(entry.title, memoryType, 10)
  const target = normalizeTitle(entry.title)
  return byTitle.some(m => normalizeTitle(m.name) === target)
}

async function runPromoteMemory(projectRoot: string, input: Input): Promise<Output> {
  const sourceRel = input.sourceFilePath?.trim() || join(LEARNINGS_DIR, LEARNINGS_FILE)
  const sourcePath = sourceRel.startsWith('/') ? sourceRel : join(projectRoot, sourceRel)
  if (!(await exists(sourcePath))) {
    return {
      success: false,
      action: 'promote_memory',
      projectRoot,
      summary: `sourceFilePath not found: ${sourcePath}`,
      promotedCount: 0,
      skippedCount: 0,
    }
  }

  const raw = await readFile(sourcePath, 'utf-8')
  const entries = parseLearningEntries(raw)
  if (entries.length === 0) {
    return {
      success: false,
      action: 'promote_memory',
      projectRoot,
      summary: `No learning entries found in ${sourcePath}.`,
      promotedCount: 0,
      skippedCount: 0,
    }
  }

  const onlyVerified = input.onlyVerified ?? true
  const maxEntries = input.maxEntries ?? 30
  const dryRun = input.dryRun ?? false
  const memoryType = (input.memoryType ?? 'feedback') as MemoryType
  const store = new MemoryStore()

  let promotedCount = 0
  let skippedCount = 0
  const dryRunPreview: string[] = []

  for (const entry of entries) {
    if (promotedCount >= maxEntries) break
    if (onlyVerified && !isVerifiedEffective(entry)) {
      skippedCount += 1
      continue
    }

    if (await hasDuplicateMemory(store, memoryType, entry)) {
      skippedCount += 1
      continue
    }

    const description = `Promoted from .learnings [${entry.id}] into long-term memory.`
    const content = [
      `Source Entry: [${entry.id}] ${entry.title}`,
      `Status: ${entry.status || 'unknown'}`,
      '',
      'Summary:',
      entry.summary || entry.title,
      '',
      'Details:',
      entry.details || '(no details)',
      '',
      `Source File: ${sourcePath}`,
      'Source: learn-tool promote_memory',
    ].join('\n')

    if (dryRun) {
      dryRunPreview.push(`[${entry.id}] ${entry.title}`)
    } else {
      await store.saveMemory(
        memoryType,
        entry.title,
        description,
        content,
        ['self-improving', 'promoted-learning', entry.id.toLowerCase()],
      )
    }
    promotedCount += 1
  }

  return {
    success: promotedCount > 0,
    action: 'promote_memory',
    projectRoot,
    summary: dryRun
      ? `Dry-run complete: would promote ${promotedCount} entries (skipped ${skippedCount}) from ${sourcePath}.`
      : `Promoted ${promotedCount} entries into MemoryTool store (skipped ${skippedCount}) from ${sourcePath}.`,
    promotedCount,
    skippedCount,
    dryRunPreview: dryRun ? dryRunPreview : undefined,
  }
}

export const SelfImprovingTool = buildTool({
  name: SELF_IMPROVING_TOOL_NAME,
  searchHint: 'self-improvement loop with metrics, prediction, adjustment, and learnings logs',
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
    return 'LearnTool'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.action}:${input.toolName ?? 'all'}`
  },
  async call(input: Input) {
    const projectRoot = getLearnToolRoot()

    switch (input.action) {
      case 'monitor':
        return { data: await runMonitor(projectRoot) }
      case 'record':
        return { data: await runRecord(projectRoot, input) }
      case 'analyze':
        return { data: await runAnalyze(projectRoot, input.toolName) }
      case 'adjust':
        return {
          data: await runAdjust(
            projectRoot,
            input.toolName,
            input.metric ?? 'execution_time',
            input.targetValue,
          ),
        }
      case 'predict':
        return {
          data: await runPredict(
            projectRoot,
            input.toolName,
            input.metric ?? 'execution_time',
            input.predictionHorizon ?? 5,
          ),
        }
      case 'report':
        return { data: await runReport(projectRoot) }
      case 'learn':
        return { data: await runLearn(projectRoot, input) }
      case 'ingest_memory':
        return { data: await runIngestMemory(projectRoot, input) }
      case 'promote_memory':
        return { data: await runPromoteMemory(projectRoot, input) }
      default:
        return {
          data: {
            success: false,
            action: input.action,
            projectRoot,
            summary: `Unknown action: ${input.action}`,
          },
        }
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lines: string[] = [output.summary]

    if (output.filesCreated?.length) {
      lines.push(`Created: ${output.filesCreated.join(', ')}`)
    }

    if (output.loggedEntryId) {
      lines.push(`Entry ID: ${output.loggedEntryId}`)
    }

    if (typeof output.promotedCount === 'number') {
      lines.push(`Promoted: ${output.promotedCount}`)
    }
    if (typeof output.skippedCount === 'number') {
      lines.push(`Skipped: ${output.skippedCount}`)
    }
    if (output.dryRunPreview?.length) {
      lines.push('DryRun Preview:')
      for (const item of output.dryRunPreview.slice(0, 10)) {
        lines.push(`- ${item}`)
      }
      if (output.dryRunPreview.length > 10) {
        lines.push(`- ...and ${output.dryRunPreview.length - 10} more`)
      }
    }

    if (output.adjustments?.length) {
      lines.push('Adjustments:')
      for (const adj of output.adjustments) {
        lines.push(
          `- ${adj.tool} ${adj.parameter}: ${adj.oldValue} -> ${adj.newValue} (${adj.reason})`,
        )
      }
    }

    if (output.predictions?.length) {
      lines.push('Predictions:')
      for (const pred of output.predictions) {
        lines.push(
          `- ${pred.tool} ${pred.metric}: current=${pred.currentValue.toFixed(2)} predicted=${pred.predictedValue.toFixed(2)} trend=${pred.trend}`,
        )
      }
    }

    if (output.recommendations?.length) {
      lines.push('Recommendations:')
      for (const rec of output.recommendations) {
        lines.push(`- ${rec}`)
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
