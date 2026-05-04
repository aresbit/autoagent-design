import { access, appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { join } from 'path'
import { getAutoMemPath } from '../../memdir/paths.js'

const PERFORMANCE_DATA_FILE = '.self_improving_performance.json'
const EXPERIENCE_STATE_FILE = '.self_improving_experience.json'
const LEARNINGS_DIR = '.learnings'
const LEARNINGS_FILE = 'LEARNINGS.md'
const SELF_IMPROVING_TOOL_NAME = 'learn-tool'

function getLearnToolRoot(): string {
  return join(getAutoMemPath(), '..', 'learn-tool')
}

type CaptureSample = {
  projectRoot: string
  toolName: string
  success: boolean
  durationMs: number
  action?: string
  error?: string
  contextSnippet?: string
  inputSizeBytes?: number
  outputSizeBytes?: number
}

type PerformanceRecord = {
  timestamp: string
  toolName: string
  action: string
  executionTimeMs: number
  success: boolean
  error?: string
}

type ExperienceState = {
  [key: string]: {
    firstSlowAt?: string
    firstSlowMs?: number
    bestMs?: number
    callCount: number
    learned: boolean
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureLearningFile(projectRoot: string): Promise<void> {
  const dir = join(projectRoot, LEARNINGS_DIR)
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
  }

  const learningsPath = join(dir, LEARNINGS_FILE)
  if (!(await exists(learningsPath))) {
    await writeFile(
      learningsPath,
      '# Learnings\n\nCorrections, insights, and knowledge gaps captured during development.\n\n**Categories**: correction | insight | knowledge_gap | best_practice\n\n---\n',
      'utf-8',
    )
  }
}

async function loadPerformance(projectRoot: string): Promise<PerformanceRecord[]> {
  const path = join(projectRoot, PERFORMANCE_DATA_FILE)
  if (!(await exists(path))) return []

  try {
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? (data as PerformanceRecord[]) : []
  } catch {
    return []
  }
}

async function savePerformance(projectRoot: string, data: PerformanceRecord[]): Promise<void> {
  const path = join(projectRoot, PERFORMANCE_DATA_FILE)
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

async function loadExperienceState(projectRoot: string): Promise<ExperienceState> {
  const path = join(projectRoot, EXPERIENCE_STATE_FILE)
  if (!(await exists(path))) return {}
  try {
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? (data as ExperienceState) : {}
  } catch {
    return {}
  }
}

async function saveExperienceState(
  projectRoot: string,
  state: ExperienceState,
): Promise<void> {
  const path = join(projectRoot, EXPERIENCE_STATE_FILE)
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8')
}

function normalizeSnippet(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const x = raw.replace(/\s+/g, ' ').trim()
  if (!x) return undefined
  return x.slice(0, 120)
}

function slowThresholdMs(toolName: string): number {
  const n = toolName.toLowerCase()
  if (n.includes('cdp') || n.includes('web') || n.includes('browser')) return 4000
  return 2000
}

function toolTypeWeight(toolName: string): number {
  const n = toolName.toLowerCase()
  if (n.includes('cdp') || n.includes('browser')) return 2.0
  if (n.includes('web') || n.includes('mcp')) return 1.6
  if (n.includes('bash') || n.includes('powershell')) return 0.6
  return 1.0
}

function estimateInfoLoad(sample: CaptureSample): number {
  const contextLen = normalizeSnippet(sample.contextSnippet)?.length ?? 0
  const inSize = sample.inputSizeBytes ?? 0
  const outSize = sample.outputSizeBytes ?? 0
  const errLen = sample.error?.length ?? 0
  // Proxy for "information amount"; weighted towards output and error surface.
  return contextLen + inSize * 0.4 + outSize * 0.8 + errLen * 1.2
}

function learnabilityScore(sample: CaptureSample): number {
  const durationScore = Math.max(0, sample.durationMs / 1000)
  const infoScore = estimateInfoLoad(sample) / 800
  return (durationScore + infoScore) * toolTypeWeight(sample.toolName)
}

function shouldTrackAsExperience(sample: CaptureSample): boolean {
  const n = sample.toolName.toLowerCase()
  const isBashLike = n.includes('bash') || n.includes('powershell')
  const score = learnabilityScore(sample)
  // Bash-like actions are considered "already internalized" by default,
  // only capture when they are unusually costly/informative.
  if (isBashLike) {
    return score >= 8.0
  }
  return score >= 4.0
}

function buildExperienceKey(
  toolName: string,
  action: string,
  contextSnippet?: string,
): string {
  const snippet = normalizeSnippet(contextSnippet)
  return `${toolName}::${action}::${snippet ?? 'default'}`
}

export async function capturePostToolUseSample(sample: CaptureSample): Promise<void> {
  if (!sample.projectRoot) return
  if (!sample.toolName) return

  // Avoid self-observability feedback loops for the improvement tool itself.
  if (sample.toolName === SELF_IMPROVING_TOOL_NAME) return
  if (!shouldTrackAsExperience(sample)) return

  const storageRoot = getLearnToolRoot()

  await ensureLearningFile(storageRoot)

  const data = await loadPerformance(storageRoot)
  const now = new Date().toISOString()

  const rec: PerformanceRecord = {
    timestamp: now,
    toolName: sample.toolName,
    action: sample.action || 'call',
    executionTimeMs: Math.max(0, Math.round(sample.durationMs)),
    success: sample.success,
    error: sample.error,
  }

  data.push(rec)
  await savePerformance(storageRoot, data)

  // Experience-oriented learning state (not per-call metric logging).
  const action = sample.action || 'call'
  const key = buildExperienceKey(sample.toolName, action, sample.contextSnippet)
  const state = await loadExperienceState(storageRoot)
  const cur = state[key] ?? { callCount: 0, learned: false }
  cur.callCount += 1
  cur.bestMs =
    cur.bestMs === undefined
      ? Math.max(0, Math.round(sample.durationMs))
      : Math.min(cur.bestMs, Math.max(0, Math.round(sample.durationMs)))

  const isSlow =
    sample.success &&
    sample.durationMs >= slowThresholdMs(sample.toolName)
  const learningsPath = join(storageRoot, LEARNINGS_DIR, LEARNINGS_FILE)
  const snippet = normalizeSnippet(sample.contextSnippet)

  if (!cur.firstSlowAt && isSlow) {
    cur.firstSlowAt = now
    cur.firstSlowMs = Math.round(sample.durationMs)
    const line =
      `\n## [AUTO-EXP ${now}] 经验候选: 首次慢调用\n` +
      `**工具/动作**: ${sample.toolName} / ${action}\n` +
      `${snippet ? `**上下文**: ${snippet}\n` : ''}` +
      `**触发条件**: 首次成功调用耗时 ${Math.round(sample.durationMs)}ms，超过阈值 ${slowThresholdMs(sample.toolName)}ms。\n` +
      `**试验与结果**: 当前仅有基线样本（慢）。\n` +
      `**有效做法（候选）**: 缩小查询范围，优先复用已验证输入结构。\n` +
      `**复用片段（草案）**:\n` +
      '```text\n' +
      `Tool=${sample.toolName}; Action=${action}; Context=${snippet ?? 'default'}; Strategy=先窄后宽\n` +
      '```\n' +
      `**适用边界**: 同类任务键=${key}\n` +
      `**下次检查项**: 关注后续样本是否出现 >=40% 提速。\n`
    await appendFile(learningsPath, line, 'utf-8')
  }

  // Internalize experience: once we observe a significant improvement after a slow baseline.
  if (
    cur.firstSlowMs !== undefined &&
    !cur.learned &&
    sample.success &&
    sample.durationMs <= cur.firstSlowMs * 0.6 &&
    cur.callCount >= 2
  ) {
    cur.learned = true
    const gainPct = Math.round((1 - sample.durationMs / cur.firstSlowMs) * 100)
    const line =
      `\n## [AUTO-EXP ${now}] 已内化经验: 同类调用显著提速\n` +
      `**工具/动作**: ${sample.toolName} / ${action}\n` +
      `${snippet ? `**上下文**: ${snippet}\n` : ''}` +
      `**触发条件**: 同类任务出现稳定提速（基线 ${cur.firstSlowMs}ms -> 当前 ${Math.round(sample.durationMs)}ms，提升 ${gainPct}%）。\n` +
      `**试验与结果**: 早期宽泛探索慢；后续复用结构化输入后明显变快。\n` +
      `**有效做法（已验证）**: 先用窄查询/限定条件命中关键目标，再逐步扩展。\n` +
      `**复用片段（建议）**:\n` +
      '```text\n' +
      `1) 固定动作: ${action}\n` +
      `2) 固定上下文骨架: ${snippet ?? 'context=default'}\n` +
      '3) 先窄后宽: 先限定关键词/目标页面，再扩展范围\n' +
      '```\n' +
      `**适用边界**: 同类任务键=${key}\n` +
      `**下次检查项**: 若连续3次回退到慢阈值以上，重开探索并更新模板。\n`
    await appendFile(learningsPath, line, 'utf-8')
  }

  // Failure also becomes explicit experiential evidence.
  if (!sample.success && sample.error) {
    const line =
      `\n## [AUTO-EXP ${now}] 失败样本\n` +
      `**工具/动作**: ${sample.toolName} / ${action}\n` +
      `${snippet ? `**上下文**: ${snippet}\n` : ''}` +
      `**触发条件**: 执行失败。\n` +
      `**错误现象**: ${sample.error.replace(/\s+/g, ' ').slice(0, 200)}\n` +
      `**回退策略**: 优先回到上次成功输入结构，缩小范围后再扩展。\n` +
      `**复用片段（防失败）**:\n` +
      '```text\n' +
      `if fail(${action}): use_last_success_pattern(); narrow_scope(); retry_once();\n` +
      '```\n' +
      `**下次检查项**: 记录下一次同类调用是否恢复成功。\n`
    await appendFile(learningsPath, line, 'utf-8')
  }

  state[key] = cur
  await saveExperienceState(storageRoot, state)
}
