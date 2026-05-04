import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { resolve, join, dirname } from 'path'
import { existsSync } from 'fs'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

// Find the CDP script path
function findCDPScriptPath(): string | null {
  // Try project root scripts directory first (development/bundled mode)
  const projectScriptPath = resolve(process.cwd(), 'scripts/cdp.mjs')
  if (existsSync(projectScriptPath)) {
    return projectScriptPath
  }

  // Try skill directory (user-installed skill)
  const skillScriptPath = join(getClaudeConfigHomeDir(), 'skills/chrome-cdp/scripts/cdp.mjs')
  if (existsSync(skillScriptPath)) {
    return skillScriptPath
  }

  return null
}

const CDP_SCRIPT_PATH = findCDPScriptPath()

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.enum([
      'list',
      'snap',
      'eval',
      'shot',
      'html',
      'nav',
      'net',
      'click',
      'clickxy',
      'type',
      'loadall',
      'evalraw',
      'stop',
    ]).describe('The CDP command to execute'),
    target: z.string().optional().describe('Target ID prefix (required for most commands except list and stop)'),
    args: z.array(z.string()).optional().describe('Additional arguments for the command'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the command succeeded'),
    output: z.string().describe('Command output'),
    error: z.string().optional().describe('Error message if command failed'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

async function runCDPCommand(
  command: string,
  target?: string,
  args?: string[],
): Promise<{ success: boolean; output: string; error?: string }> {
  if (!CDP_SCRIPT_PATH) {
    return { success: false, output: '', error: 'CDP script not found. Please ensure chrome-cdp skill is installed.' }
  }

  const cmdArgs = [command]
  if (target) cmdArgs.push(target)
  if (args) cmdArgs.push(...args)

  try {
    const proc = Bun.spawn(['node', CDP_SCRIPT_PATH, ...cmdArgs], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 0) {
      return { success: true, output: stdout.trim() }
    } else {
      return { success: false, output: stdout.trim(), error: stderr.trim() || 'Command failed' }
    }
  } catch (err) {
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) }
  }
}

export const ChromeCDPTool = buildTool({
  name: 'ChromeCDP',
  searchHint: 'interact with Chrome browser via DevTools Protocol',
  maxResultSizeChars: 100_000,
  isEnabled() {
    // Only enable if the CDP script is available
    return CDP_SCRIPT_PATH !== null
  },
  async description(input) {
    const { command, target } = input as { command: string; target?: string }
    if (command === 'list') {
      return 'Claude wants to list open Chrome pages'
    }
    if (target) {
      return `Claude wants to execute "${command}" on Chrome page ${target}`
    }
    return `Claude wants to execute "${command}" on Chrome`
  },
  userFacingName() {
    return 'Chrome CDP'
  },
  getActivityDescription(input) {
    const { command, target } = input || {}
    if (command === 'list') return 'Listing Chrome pages'
    if (command === 'snap') return `Taking accessibility snapshot${target ? ` of ${target}` : ''}`
    if (command === 'shot') return `Taking screenshot${target ? ` of ${target}` : ''}`
    if (command === 'nav') return `Navigating${target ? ` ${target}` : ''}`
    if (command === 'eval') return `Evaluating JavaScript${target ? ` on ${target}` : ''}`
    if (command === 'click') return `Clicking element${target ? ` on ${target}` : ''}`
    if (command === 'type') return `Typing text${target ? ` on ${target}` : ''}`
    if (command === 'html') return `Getting HTML${target ? ` from ${target}` : ''}`
    if (command === 'net') return `Getting network entries${target ? ` from ${target}` : ''}`
    return `Running Chrome CDP ${command}`
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
  isReadOnly(input) {
    const { command } = input || {}
    // These commands don't modify the page
    return ['list', 'snap', 'shot', 'html', 'net'].includes(command || '')
  },
  isDestructive(input) {
    const { command } = input || {}
    // nav and click can change page state
    return ['nav', 'click', 'clickxy', 'type', 'loadall'].includes(command || '')
  },
  toAutoClassifierInput(input) {
    const { command, target, args } = input || {}
    return `${command} ${target || ''} ${args?.join(' ') || ''}`.trim()
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    // CDP commands require explicit user approval
    const { command, target } = input
    return {
      behavior: 'ask',
      message: `Claude wants to execute Chrome CDP command "${command}"${target ? ` on page ${target}` : ''}. This will interact with your local Chrome browser.`,
    }
  },
  async prompt() {
    return `Interact with local Chrome browser via Chrome DevTools Protocol (CDP).

Use this tool to:
- List open Chrome pages: command 'list'
- Navigate to a URL: command 'nav' with args ['https://example.com']
- Execute JavaScript: command 'eval' with args ['console.log(document.title)']
- Take screenshots: command 'shot'
- Get page HTML: command 'html'
- Get accessibility snapshot: command 'snap'
- Click elements: command 'click' with args ['selector'] or 'clickxy' with args ['x', 'y']
- Type text: command 'type' with args ['selector', 'text']
- Get network entries: command 'net'
- Stop CDP session: command 'stop'

Most commands require a target ID prefix. Use 'list' first to get available targets.
This tool requires explicit user approval for each use.`
  },
  async validateInput(input) {
    const { command, target } = input
    const needsTarget = !['list', 'stop'].includes(command)
    if (needsTarget && !target) {
      return {
        result: false,
        message: `Error: target is required for command "${command}"`,
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage(input, { theme }) {
    const { command, target } = input || {}
    return `Chrome CDP: ${command}${target ? ` ${target}` : ''}`
  },
  async call({ command, target, args }) {
    const result = await runCDPCommand(command, target, args)
    return {
      data: result,
    }
  },
  mapToolResultToToolResultBlockParam(result, toolUseID) {
    const content = result.success
      ? result.output
      : `Error: ${result.error || 'Unknown error'}\n${result.output}`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
