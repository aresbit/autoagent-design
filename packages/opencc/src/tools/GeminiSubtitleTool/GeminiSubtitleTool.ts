import { existsSync } from 'fs'
import { resolve, join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import {
  DESCRIPTION,
  GEMINI_SUBTITLE_TOOL_NAME,
  getPrompt,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    request: z
      .string()
      .min(1)
      .describe('Instruction sent to your Gemini Gem for subtitle generation'),
    gemUrl: z
      .string()
      .url()
      .default('https://gemini.google.com/gem/')
      .describe('Gemini Gem URL, usually https://gemini.google.com/gem/...'),
    target: z
      .string()
      .optional()
      .describe('Optional CDP target ID prefix; if omitted, auto-detect Gemini tab'),
    timeoutMs: z
      .number()
      .int()
      .min(15000)
      .max(600000)
      .default(180000)
      .describe('Total timeout for waiting model output'),
    pollIntervalMs: z
      .number()
      .int()
      .min(500)
      .max(10000)
      .default(1500)
      .describe('Polling interval while waiting for Gemini response'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether subtitle output was successfully captured'),
    subtitle: z.string().describe('Captured text from Gemini response'),
    target: z.string().optional().describe('CDP target used'),
    gemUrl: z.string().describe('Gem URL used for navigation'),
    message: z.string().describe('Status message'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

type ProcResult = { code: number | null; stdout: string; stderr: string }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function findCDPScriptPath(): string | null {
  const candidates = [
    resolve(process.cwd(), 'scripts/cdp.mjs'),
    resolve(__dirname, '../../../scripts/cdp.mjs'),
    join(getClaudeConfigHomeDir(), 'skills/chrome-cdp/scripts/cdp.mjs'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function runProcess(command: string, args: string[], timeoutMs = 30000): Promise<ProcResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      // no-op
    }
  }, timeoutMs)

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer))

  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

function parseCdpListOutput(content: string): Array<{ prefix: string; url: string; raw: string }> {
  const rows: Array<{ prefix: string; url: string; raw: string }> = []
  for (const line of content.split('\n').map(l => l.trimEnd()).filter(Boolean)) {
    const match = line.match(/^([0-9a-fA-F]+)\s+.*\s+(https?:\/\/\S+)$/)
    if (!match) continue
    rows.push({ prefix: match[1] as string, url: match[2] as string, raw: line })
  }
  return rows
}

function buildGemRequest(request: string): string {
  return `请基于以下内容输出沙中文字幕（SRT）。\n要求：\n1) 仅输出最终字幕内容\n2) 使用简体中文\n3) 保持时间轴格式规范\n\n内容如下：\n${request}`
}

const FOCUS_INPUT_EXPR = `(() => {
  const selectors = ['div[contenteditable="true"]', 'textarea', '[role="textbox"]'];
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const el = node;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    el.focus();
    return selector;
  }
  return '__NO_INPUT__';
})()`

const SUBMIT_EXPR = `(() => {
  const selectors = [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[data-test-id*="send"]',
    'button[type="submit"]'
  ];
  for (const selector of selectors) {
    const btn = document.querySelector(selector);
    if (!btn) continue;
    const disabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
    if (disabled) continue;
    btn.click();
    return 'clicked:' + selector;
  }
  const active = document.activeElement;
  if (active) {
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return 'enter';
  }
  return '__NO_SUBMIT__';
})()`

const READ_LAST_MODEL_TEXT_EXPR = `(() => {
  const selectors = [
    '[data-message-author-role="model"]',
    'model-response',
    '.model-response-text',
    'main .markdown',
    'main [data-test-id*="model"]',
    'main article'
  ];
  const texts = [];
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      const text = (node.innerText || '').trim();
      if (!text) continue;
      texts.push(text);
    }
  }
  if (texts.length === 0) return '';
  return texts[texts.length - 1];
})()`

async function runCdp(cdpScriptPath: string, cmd: string, ...args: string[]): Promise<ProcResult> {
  return runProcess('bun', [cdpScriptPath, cmd, ...args], 45000)
}

function normalizeEvalOutput(value: string): string {
  const trimmed = value.trim()
  if (trimmed === 'undefined' || trimmed === 'null') return ''
  return trimmed
}

async function pickTarget(cdpScriptPath: string, preferredTarget?: string): Promise<string> {
  if (preferredTarget?.trim()) {
    return preferredTarget.trim()
  }

  const list = await runCdp(cdpScriptPath, 'list')
  if ((list.code ?? 1) !== 0) {
    throw new Error(`cdp list failed: ${(list.stderr || list.stdout).trim()}`)
  }

  const rows = parseCdpListOutput(list.stdout)
  if (!rows.length) {
    throw new Error('No Chrome page target detected. Open at least one tab and retry.')
  }

  const gemRow = rows.find(row => row.url.includes('gemini.google.com'))
  return (gemRow || rows[0])?.prefix || rows[0].prefix
}

async function focusInput(cdpScriptPath: string, target: string): Promise<void> {
  const tryClickSelectors = ['div[contenteditable="true"]', 'textarea', '[role="textbox"]']
  for (const selector of tryClickSelectors) {
    const clicked = await runCdp(cdpScriptPath, 'click', target, selector)
    if ((clicked.code ?? 1) === 0) {
      return
    }
  }

  const focus = await runCdp(cdpScriptPath, 'eval', target, FOCUS_INPUT_EXPR)
  if ((focus.code ?? 1) !== 0 || normalizeEvalOutput(focus.stdout) === '__NO_INPUT__') {
    throw new Error('Failed to focus Gemini input box.')
  }
}

export const GeminiSubtitleTool = buildTool({
  name: GEMINI_SUBTITLE_TOOL_NAME,
  searchHint: 'generate Chinese subtitles via Gemini Gem through Chrome CDP',
  maxResultSizeChars: 200_000,
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
    return 'GeminiSubtitleTool'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return true
  },
  async checkPermissions(): Promise<PermissionDecision> {
    return {
      behavior: 'ask',
      message:
        'Claude wants to control your local Chrome tab via CDP to invoke Gemini Gem for subtitle generation.',
    }
  },
  toAutoClassifierInput(input) {
    return `${input.gemUrl} ${input.request.slice(0, 120)}`
  },
  async call(input: Input) {
    const cdpScriptPath = findCDPScriptPath()
    if (!cdpScriptPath) {
      return {
        data: {
          success: false,
          subtitle: '',
          gemUrl: input.gemUrl,
          message: 'CDP script not found. Ensure scripts/cdp.mjs exists or install chrome-cdp skill.',
        },
      }
    }

    const target = await pickTarget(cdpScriptPath, input.target)

    const nav = await runCdp(cdpScriptPath, 'nav', target, input.gemUrl)
    if ((nav.code ?? 1) !== 0) {
      return {
        data: {
          success: false,
          subtitle: '',
          target,
          gemUrl: input.gemUrl,
          message: `Failed to navigate Gemini tab: ${(nav.stderr || nav.stdout).trim()}`,
        },
      }
    }

    await sleep(1200)
    await focusInput(cdpScriptPath, target)

    const composedRequest = buildGemRequest(input.request)
    const typed = await runCdp(cdpScriptPath, 'type', target, composedRequest)
    if ((typed.code ?? 1) !== 0) {
      return {
        data: {
          success: false,
          subtitle: '',
          target,
          gemUrl: input.gemUrl,
          message: `Failed to type request: ${(typed.stderr || typed.stdout).trim()}`,
        },
      }
    }

    const submit = await runCdp(cdpScriptPath, 'eval', target, SUBMIT_EXPR)
    if ((submit.code ?? 1) !== 0) {
      return {
        data: {
          success: false,
          subtitle: '',
          target,
          gemUrl: input.gemUrl,
          message: `Failed to submit request: ${(submit.stderr || submit.stdout).trim()}`,
        },
      }
    }

    const deadline = Date.now() + input.timeoutMs
    let last = ''
    let stableCount = 0

    while (Date.now() < deadline) {
      await sleep(input.pollIntervalMs)
      const read = await runCdp(cdpScriptPath, 'eval', target, READ_LAST_MODEL_TEXT_EXPR)
      if ((read.code ?? 1) !== 0) {
        continue
      }

      const text = normalizeEvalOutput(read.stdout)
      if (!text || text === last || text.includes(composedRequest.slice(0, 60))) {
        if (text && text === last) {
          stableCount += 1
        }
      } else {
        last = text
        stableCount = 1
      }

      if (last && stableCount >= 2) {
        return {
          data: {
            success: true,
            subtitle: last,
            target,
            gemUrl: input.gemUrl,
            message: 'Subtitle text captured from Gemini response.',
          },
        }
      }
    }

    return {
      data: {
        success: false,
        subtitle: last,
        target,
        gemUrl: input.gemUrl,
        message: last
          ? 'Timed out before response stabilized. Returning latest captured text.'
          : 'Timed out waiting for Gemini response.',
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.success ? content.subtitle : `geminisubtitle failed: ${content.message}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
