import { access, mkdir, readFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { DESCRIPTION, getPrompt, PAPER2CODE_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    arxivId: z
      .string()
      .describe(
        'arXiv ID or URL (e.g., "1706.03762" or "https://arxiv.org/abs/1706.03762")',
      ),
    framework: z
      .enum(['pytorch', 'jax', 'tensorflow', 'none'])
      .optional()
      .default('pytorch')
      .describe('Framework hint recorded in the output metadata'),
    mode: z
      .enum(['minimal', 'full', 'educational'])
      .optional()
      .default('minimal')
      .describe('Generation mode hint recorded in the output metadata'),
    outputDir: z
      .string()
      .optional()
      .describe('Output directory (default: ./paper2code_output/{arxiv_id}/)'),
    installIfMissing: z
      .boolean()
      .optional()
      .default(false)
      .describe('Deprecated compatibility flag. No-op in local-script mode.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    message: z.string().describe('Status message'),
    outputDir: z
      .string()
      .optional()
      .describe('Output directory containing generated files'),
    files: z.array(z.string()).optional().describe('Generated files'),
    paperTitle: z.string().optional().describe('Paper title'),
    paperAuthors: z.array(z.string()).optional().describe('Paper authors'),
    installed: z
      .boolean()
      .optional()
      .describe('Compatibility field; always false in local-script mode'),
    skillAvailable: z
      .boolean()
      .optional()
      .describe('Compatibility field; always true in local-script mode'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

type PaperMetadata = {
  title?: string
  authors?: string[]
}

function normalizeArxivId(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
    .replace(/^https?:\/\/arxiv\.org\/pdf\//, '')
    .replace(/\.pdf$/, '')
    .replace(/\/$/, '')
}

function defaultOutputDir(arxivId: string): string {
  return resolve(
    process.cwd(),
    'paper2code_output',
    arxivId.replace(/[^a-zA-Z0-9._-]/g, '_'),
  )
}

function getSkillRoot(): string {
  return resolve(
    process.cwd(),
    'src',
    'tools',
    'Paper2CodeTool',
    'skill',
    'paper2code',
  )
}

function getScripts(): { fetch: string; extract: string } {
  const root = getSkillRoot()
  return {
    fetch: join(root, 'scripts', 'fetch_paper.py'),
    extract: join(root, 'scripts', 'extract_structure.py'),
  }
}

async function ensureFileExists(path: string): Promise<void> {
  await access(path, fsConstants.F_OK)
}

async function runCommand(
  command: string[],
  cwd: string,
  signal: AbortSignal,
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

  return { stdout, stderr }
}

async function ensurePythonModule(
  python: string,
  moduleName: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await runCommand(
      [python, '-c', `import ${moduleName}`],
      process.cwd(),
      signal,
    )
  } catch {
    await runCommand(
      [python, '-m', 'pip', 'install', moduleName],
      process.cwd(),
      signal,
    )
  }
}

function getVenvPython(venvDir: string): string {
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')
}

async function preparePythonRuntime(
  python: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await ensurePythonModule(python, 'requests', signal)
    return python
  } catch {
    const venvDir = resolve(process.cwd(), '.paper2code_venv')
    const venvPython = getVenvPython(venvDir)

    try {
      await ensureFileExists(venvPython)
    } catch {
      await runCommand([python, '-m', 'venv', venvDir], process.cwd(), signal)
    }

    await ensurePythonModule(venvPython, 'requests', signal)
    return venvPython
  }
}

async function loadMetadata(outputDir: string): Promise<PaperMetadata | null> {
  try {
    const raw = await readFile(join(outputDir, 'paper_metadata.json'), 'utf-8')
    return JSON.parse(raw) as PaperMetadata
  } catch {
    return null
  }
}

async function collectGeneratedFiles(outputDir: string): Promise<string[]> {
  const candidates = [
    'paper_text.md',
    'paper_metadata.json',
    'footnotes.md',
    join('sections'),
    join('algorithms'),
    join('equations'),
    join('tables'),
  ]

  const existing: string[] = []
  for (const rel of candidates) {
    try {
      await access(join(outputDir, rel), fsConstants.F_OK)
      existing.push(rel)
    } catch {
      // ignore missing optional artifacts
    }
  }
  return existing
}

function renderToolUseMessage(input: Partial<Input>): string | null {
  if (!input.arxivId) return null
  return `paper2code ${input.arxivId}`
}

export const Paper2CodeTool = buildTool({
  name: PAPER2CODE_TOOL_NAME,
  searchHint: 'generate code from arXiv papers',
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
    return 'Paper2CodeTool'
  },
  shouldDefer: true,
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `paper2code ${input.arxivId}`
  },
  renderToolUseMessage,
  async call(input, context) {
    const arxivId = normalizeArxivId(input.arxivId)
    const outputDir = input.outputDir
      ? resolve(process.cwd(), input.outputDir)
      : defaultOutputDir(arxivId)
    const scripts = getScripts()
    const python = process.env.PYTHON || 'python3'

    try {
      await ensureFileExists(scripts.fetch)
      await ensureFileExists(scripts.extract)
      const runtimePython = await preparePythonRuntime(
        python,
        context.abortController.signal,
      )

      await mkdir(outputDir, { recursive: true })

      await runCommand(
        [runtimePython, scripts.fetch, arxivId, outputDir],
        process.cwd(),
        context.abortController.signal,
      )

      const paperTextPath = join(outputDir, 'paper_text.md')
      await ensureFileExists(paperTextPath)

      await runCommand(
        [runtimePython, scripts.extract, paperTextPath, outputDir],
        process.cwd(),
        context.abortController.signal,
      )

      const metadata = await loadMetadata(outputDir)
      const files = await collectGeneratedFiles(outputDir)

      return {
        data: {
          success: true,
          message: `paper2code prepared source artifacts for ${arxivId}`,
          outputDir,
          files,
          paperTitle: metadata?.title,
          paperAuthors: metadata?.authors,
          installed: false,
          skillAvailable: true,
        },
      }
    } catch (error) {
      return {
        data: {
          success: false,
          message: `Paper2CodeTool failed for ${arxivId}: ${error instanceof Error ? error.message : String(error)}`,
          outputDir,
          installed: false,
          skillAvailable: true,
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const result = output as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result.success
        ? result.message
        : `paper2code failed: ${result.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
