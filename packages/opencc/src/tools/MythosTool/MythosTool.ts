import { access, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runAgent } from '../AgentTool/runAgent.js'
import type { Message } from '../../types/message.js'
import { createUserMessage } from '../../utils/messages.js'
import { getCwd } from '../../utils/cwd.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  userFacingName,
} from './UI.js'
import {
  CODA_SYSTEM_PROMPT,
  MYTHOS_TOOL_NAME,
  PRELUDE_SYSTEM_PROMPT,
  RECURRENT_BLOCK_SYSTEM_PROMPT,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['research', 'status', 'continue', 'clear'])
      .optional()
      .default('research')
      .describe('Action to perform. Default: research'),
    topic: z
      .string()
      .optional()
      .describe('Research topic or question. Required for research action.'),
    depth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(3)
      .describe('Maximum recurrent depth for deep dives (1-10). Default: 3'),
    breadth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .default(2)
      .describe('Number of parallel research directions per depth. Default: 2'),
    outputDir: z
      .string()
      .optional()
      .describe('Output directory for research artifacts. Default: ./mythos_output/'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const findingSchema = z.object({
  depth: z.number(),
  direction: z.string(),
  findings: z.array(z.string()),
  sources: z.array(z.string()),
  openQuestions: z.array(z.string()),
  crossReferences: z.array(z.string()),
  timestamp: z.number(),
})

const latentStateSchema = z.object({
  topic: z.string(),
  landscapeMap: z.string().optional(),
  accumulatedFindings: z.array(z.string()),
  openQuestions: z.array(z.string()),
  sources: z.array(z.string()),
  contradictions: z.array(z.string()),
  currentDepth: z.number(),
  maxDepth: z.number(),
  breadth: z.number(),
  directions: z.array(z.string()),
  completedDirections: z.array(z.string()),
})

const runtimeStateSchema = z.object({
  mode: z.enum(['active', 'inactive']),
  workDir: z.string(),
  topic: z.string().optional(),
  updatedAt: z.string(),
  latentState: latentStateSchema.optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the research succeeded'),
    mode: z.enum(['active', 'inactive']).describe('Mythos mode after this call'),
    action: z
      .enum(['research', 'status', 'continue', 'clear'])
      .describe('Executed action'),
    message: z.string().describe('Status message'),
    reportPath: z.string().optional().describe('Path to generated research report'),
    depthReached: z.number().optional().describe('Maximum depth reached'),
    findingsCount: z.number().optional().describe('Total findings accumulated'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export type MythosProgress = {
  type: 'mythos_progress'
  phase: 'prelude' | 'recurrent' | 'coda'
  depth?: number
  direction?: string
  message: Message
}

const MYTHOS_STATE = 'mythos_state.json'
const MYTHOS_FINDINGS = 'mythos_findings.jsonl'
const MYTHOS_REPORT = 'mythos_research.md'
const MYTHOS_SOURCES = 'mythos_sources.md'
const DEFAULT_DEPTH = 3
const DEFAULT_BREADTH = 2

function nowIso(): string {
  return new Date().toISOString()
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function defaultOutputDir(topic: string): string {
  const sanitized = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 50)
    .replace(/^_+|_+$/g, '')
  return resolve(process.cwd(), 'mythos_output', sanitized || 'research')
}

async function readRuntimeState(workDir: string): Promise<typeof runtimeStateSchema._type | null> {
  const p = join(workDir, MYTHOS_STATE)
  if (!(await exists(p))) return null
  try {
    const raw = await readFile(p, 'utf-8')
    return JSON.parse(raw) as typeof runtimeStateSchema._type
  } catch {
    return null
  }
}

async function writeRuntimeState(
  workDir: string,
  state: typeof runtimeStateSchema._type,
): Promise<void> {
  await writeFile(join(workDir, MYTHOS_STATE), JSON.stringify(state, null, 2), 'utf-8')
}

async function appendFindings(workDir: string, record: typeof findingSchema._type): Promise<void> {
  const p = join(workDir, MYTHOS_FINDINGS)
  let current = ''
  if (await exists(p)) {
    current = await readFile(p, 'utf-8')
  }
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await writeFile(p, `${current}${prefix}${JSON.stringify(record)}\n`, 'utf-8')
}

async function initWorkspace(
  workDir: string,
  topic: string,
  depth: number,
  breadth: number,
): Promise<void> {
  await mkdir(workDir, { recursive: true })

  const initialState: typeof runtimeStateSchema._type = {
    mode: 'active',
    workDir,
    topic,
    updatedAt: nowIso(),
    latentState: {
      topic,
      accumulatedFindings: [],
      openQuestions: [],
      sources: [],
      contradictions: [],
      currentDepth: 0,
      maxDepth: depth,
      breadth,
      directions: [],
      completedDirections: [],
    },
  }
  await writeRuntimeState(workDir, initialState)
}

function buildPreludePrompt(topic: string): string {
  return `${PRELUDE_SYSTEM_PROMPT}\n\nResearch topic: ${topic}\n\nPerform broad exploration now.`
}

function buildRecurrentPrompt(
  direction: string,
  depth: number,
  latentState: typeof latentStateSchema._type,
): string {
  const stateSummary = [
    '## Latent State (accumulated from previous depths)',
    `Topic: ${latentState.topic}`,
    `Accumulated findings:`,
    ...latentState.accumulatedFindings.map(f => `- ${f}`),
    `Open questions:`,
    ...latentState.openQuestions.map(q => `- ${q}`),
    `Prior sources:`,
    ...latentState.sources.map(s => `- ${s}`),
    latentState.contradictions.length > 0 ? `Known contradictions:` : '',
    ...latentState.contradictions.map(c => `- ${c}`),
  ].join('\n')

  return `${RECURRENT_BLOCK_SYSTEM_PROMPT}\n\n${stateSummary}\n\n## Current Task\nDirection: ${direction}\nDepth level: ${depth}\n\nExecute deep dive now.`
}

function buildCodaPrompt(topic: string, latentState: typeof latentStateSchema._type): string {
  const stateSummary = [
    '## Complete Latent State',
    `Topic: ${latentState.topic}`,
    `Depths explored: ${latentState.currentDepth} / ${latentState.maxDepth}`,
    `Directions explored: ${latentState.completedDirections.join(', ')}`,
    `Accumulated findings:`,
    ...latentState.accumulatedFindings.map(f => `- ${f}`),
    `Open questions:`,
    ...latentState.openQuestions.map(q => `- ${q}`),
    `Sources consulted:`,
    ...latentState.sources.map(s => `- ${s}`),
    `Contradictions noted:`,
    ...latentState.contradictions.map(c => `- ${c}`),
  ].join('\n')

  return `${CODA_SYSTEM_PROMPT}\n\n${stateSummary}\n\nResearch topic: ${topic}\n\nProduce final synthesis now.`
}

async function runSubagentPhase(
  promptText: string,
  context: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[1] : never,
  canUseTool: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[2] : never,
  parentMessage: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[3] : never,
  onProgress: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[4] : never,
  phase: MythosProgress['phase'],
  depth?: number,
  direction?: string,
): Promise<string> {
  const { GENERAL_PURPOSE_AGENT } = await import('../AgentTool/built-in/generalPurposeAgent.js')
  const userMessage = createUserMessage(promptText)
  const agentMessages: Message[] = []

  for await (const message of runAgent({
    agentDefinition: GENERAL_PURPOSE_AGENT,
    promptMessages: [userMessage],
    toolUseContext: context,
    canUseTool,
    isAsync: false,
    querySource: 'agent:custom',
    model: undefined,
    availableTools: context.options.tools,
    override: { agentId: `mythos-${phase}-${Date.now()}` },
  })) {
    agentMessages.push(message)

    if (onProgress && (message.type === 'assistant' || message.type === 'user')) {
      onProgress({
        toolUseID: `mythos_${parentMessage?.message.id || 'unknown'}`,
        data: {
          message,
          type: 'mythos_progress',
          phase,
          depth,
          direction,
        } satisfies MythosProgress,
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
  return resultText.trim()
}

function extractSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const regex = /##\s+(.+?)\n([\s\S]*?)(?=\n##\s+|\n#\s+|$)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const title = match[1].trim().toLowerCase().replace(/\s+/g, '_')
    sections[title] = match[2].trim()
  }
  return sections
}

function parseBulletList(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- ') || line.startsWith('* '))
    .map(line => line.slice(2).trim())
    .filter(Boolean)
}

function parseNumberedList(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+\.\s/.test(line))
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
}

async function runPrelude(
  workDir: string,
  topic: string,
  context: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[1] : never,
  canUseTool: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[2] : never,
  parentMessage: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[3] : never,
  onProgress: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[4] : never,
): Promise<{ landscapeMap: string; directions: string[] }> {
  const preludeText = await runSubagentPhase(
    buildPreludePrompt(topic),
    context,
    canUseTool,
    parentMessage,
    onProgress,
    'prelude',
  )

  const sections = extractSections(preludeText)
  const directionsText =
    sections['recommended_deep_dive_directions_ranked'] ||
    sections['deep_dive_directions'] ||
    sections['recommended_directions'] ||
    ''
  const directions = parseNumberedList(directionsText).slice(0, 5)

  // Save prelude output
  await writeFile(join(workDir, 'mythos_prelude.md'), preludeText, 'utf-8')

  return {
    landscapeMap: preludeText,
    directions: directions.length > 0 ? directions : [topic],
  }
}

async function runRecurrentDepth(
  workDir: string,
  direction: string,
  depth: number,
  latentState: typeof latentStateSchema._type,
  context: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[1] : never,
  canUseTool: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[2] : never,
  parentMessage: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[3] : never,
  onProgress: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[4] : never,
): Promise<{
  findings: string[]
  sources: string[]
  openQuestions: string[]
  crossReferences: string[]
}> {
  const recurrentText = await runSubagentPhase(
    buildRecurrentPrompt(direction, depth, latentState),
    context,
    canUseTool,
    parentMessage,
    onProgress,
    'recurrent',
    depth,
    direction,
  )

  const sections = extractSections(recurrentText)

  const findings = parseBulletList(sections['new_findings'] || '')
  const sources = parseBulletList(sections['sources'] || '')
  const openQuestions = parseBulletList(sections['new_open_questions'] || sections['open_questions'] || '')
  const crossReferences = parseBulletList(sections['cross_references_with_prior_state'] || sections['cross_references'] || '')

  await appendFindings(workDir, {
    depth,
    direction,
    findings,
    sources,
    openQuestions,
    crossReferences,
    timestamp: Date.now(),
  })

  return { findings, sources, openQuestions, crossReferences }
}

async function runCoda(
  workDir: string,
  topic: string,
  latentState: typeof latentStateSchema._type,
  context: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[1] : never,
  canUseTool: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[2] : never,
  parentMessage: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[3] : never,
  onProgress: Parameters<typeof buildTool>[0] extends { call: (...args: infer P) => any } ? P[4] : never,
): Promise<string> {
  const codaText = await runSubagentPhase(
    buildCodaPrompt(topic, latentState),
    context,
    canUseTool,
    parentMessage,
    onProgress,
    'coda',
  )

  const reportPath = join(workDir, MYTHOS_REPORT)
  await writeFile(reportPath, codaText, 'utf-8')

  // Also write sources file
  const sourcesContent = [
    '# Mythos Research Sources',
    `Topic: ${topic}`,
    `Generated: ${nowIso()}`,
    '',
    '## Sources Consulted',
    ...latentState.sources.map(s => `- ${s}`),
    '',
    '## Directions Explored',
    ...latentState.completedDirections.map(d => `- ${d}`),
  ].join('\n')
  await writeFile(join(workDir, MYTHOS_SOURCES), sourcesContent, 'utf-8')

  return reportPath
}

export const MythosTool = buildTool({
  name: MYTHOS_TOOL_NAME,
  searchHint: 'deep recursive research with latent state',
  maxResultSizeChars: 100_000,
  userFacingName,
  async description() {
    return 'Perform deep multi-phase research with recurrent-depth reasoning. Inspired by OpenMythos RDT architecture: Prelude -> Recurrent Block -> Coda.'
  },
  async prompt() {
    return 'Mythos tool: supports action=research|status|continue|clear. Performs deep research with three phases: Prelude (landscape mapping), Recurrent Block (iterative deep dives with state passing), and Coda (synthesis). Produces mythos_research.md, mythos_findings.jsonl, and mythos_sources.md.'
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
    const safeOutput = output && typeof output === 'object' ? (output as Partial<Output>) : undefined
    const content = typeof safeOutput?.message === 'string' ? safeOutput.message : 'Mythos research failed before producing a structured result.'
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
    const action = input.action ?? 'research'
    const cwd = getCwd()
    const topic = input.topic?.trim()
    const workDir = input.outputDir
      ? isAbsolute(input.outputDir)
        ? input.outputDir
        : resolve(cwd, input.outputDir)
      : topic
        ? defaultOutputDir(topic)
        : resolve(cwd, 'mythos_output')

    if (action === 'status') {
      const runtime = await readRuntimeState(workDir)
      const ls = runtime?.latentState
      const message = [
        `Mode: ${runtime?.mode ?? 'inactive'}`,
        `Work dir: ${workDir}`,
        ls ? `Topic: ${ls.topic}` : '',
        ls ? `Depth: ${ls.currentDepth} / ${ls.maxDepth}` : '',
        ls ? `Directions completed: ${ls.completedDirections.length}` : '',
        ls ? `Accumulated findings: ${ls.accumulatedFindings.length}` : '',
        ls ? `Open questions: ${ls.openQuestions.length}` : '',
        ls ? `Sources: ${ls.sources.length}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      return {
        success: true,
        mode: runtime?.mode ?? 'inactive',
        action,
        message,
        reportPath: ls && ls.currentDepth >= ls.maxDepth ? join(workDir, MYTHOS_REPORT) : undefined,
        depthReached: ls?.currentDepth,
        findingsCount: ls?.accumulatedFindings.length,
      }
    }

    if (action === 'clear') {
      const files = [MYTHOS_STATE, MYTHOS_FINDINGS, MYTHOS_REPORT, MYTHOS_SOURCES, 'mythos_prelude.md']
      for (const f of files) {
        const p = join(workDir, f)
        if (await exists(p)) {
          await rm(p, { force: true })
        }
      }
      return {
        success: true,
        mode: 'inactive',
        action,
        message: `Cleared Mythos research artifacts in ${workDir}`,
      }
    }

    // research or continue
    if (action === 'research' && !topic) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: 'action=research requires a topic.',
      }
    }

    let runtime = await readRuntimeState(workDir)
    const isContinue = action === 'continue' && runtime?.latentState

    if (action === 'research' || !isContinue) {
      const depth = input.depth ?? DEFAULT_DEPTH
      const breadth = input.breadth ?? DEFAULT_BREADTH
      await initWorkspace(workDir, topic!, depth, breadth)
      runtime = await readRuntimeState(workDir)
    }

    if (!runtime?.latentState) {
      return {
        success: false,
        mode: 'inactive',
        action,
        message: 'Failed to initialize Mythos workspace.',
      }
    }

    const ls = runtime.latentState
    const effectiveTopic = ls.topic
    const maxDepth = ls.maxDepth
    const breadth = ls.breadth

    try {
      // PHASE 1: PRELUDE (only if starting fresh)
      let directions: string[]
      if (!isContinue || ls.directions.length === 0) {
        const preludeResult = await runPrelude(
          workDir,
          effectiveTopic,
          context,
          canUseTool,
          parentMessage,
          onProgress,
        )
        directions = preludeResult.directions
        ls.landscapeMap = preludeResult.landscapeMap
        ls.directions = directions
      } else {
        directions = ls.directions
      }

      // PHASE 2: RECURRENT BLOCK
      const startDepth = isContinue ? ls.currentDepth + 1 : 1
      for (let d = startDepth; d <= maxDepth; d++) {
        ls.currentDepth = d - 1 // mark as working on depth d

        // Select directions for this depth (breadth-controlled)
        const availableDirections = directions.filter(
          dir => !ls.completedDirections.includes(dir),
        )
        const selectedDirections = availableDirections.slice(0, breadth)
        if (selectedDirections.length === 0) {
          // If all directions explored, recycle with refined focus
          selectedDirections.push(...directions.slice(0, breadth))
        }

        for (const direction of selectedDirections) {
          const result = await runRecurrentDepth(
            workDir,
            direction,
            d,
            ls,
            context,
            canUseTool,
            parentMessage,
            onProgress,
          )

          // Update latent state (the "recurrent" part)
          ls.accumulatedFindings.push(...result.findings)
          ls.sources.push(...result.sources)
          ls.openQuestions.push(...result.openQuestions)
          ls.contradictions.push(...result.crossReferences.filter(x => x.toLowerCase().includes('contradict')))
          ls.completedDirections.push(direction)
        }

        ls.currentDepth = d
        await writeRuntimeState(workDir, {
          ...runtime,
          mode: 'active',
          updatedAt: nowIso(),
          latentState: ls,
        })
      }

      // PHASE 3: CODA
      const reportPath = await runCoda(
        workDir,
        effectiveTopic,
        ls,
        context,
        canUseTool,
        parentMessage,
        onProgress,
      )

      await writeRuntimeState(workDir, {
        ...runtime,
        mode: 'inactive',
        updatedAt: nowIso(),
        latentState: ls,
      })

      return {
        success: true,
        mode: 'inactive',
        action,
        message: `Mythos deep research completed for "${effectiveTopic}".\nDepth reached: ${ls.currentDepth} / ${maxDepth}\nFindings: ${ls.accumulatedFindings.length}\nDirections explored: ${ls.completedDirections.length}\nReport: ${reportPath}`,
        reportPath,
        depthReached: ls.currentDepth,
        findingsCount: ls.accumulatedFindings.length,
      }
    } catch (error) {
      await writeRuntimeState(workDir, {
        ...runtime,
        mode: 'inactive',
        updatedAt: nowIso(),
        latentState: ls,
      })
      return {
        success: false,
        mode: 'inactive',
        action,
        message: `Mythos research failed: ${error instanceof Error ? error.message : String(error)}\nWork dir: ${workDir}`,
      }
    }
  },
  toAutoClassifierInput(input) {
    return input.topic ? `mythos research ${input.topic}` : 'mythos research'
  },
} satisfies ToolDef<InputSchema, Output>)
