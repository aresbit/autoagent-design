import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { isPreapprovedHost } from './preapproved.js'
import { DESCRIPTION, WEB_FETCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  applyPromptToMarkdown,
  fetchContent,
  fetchViaCDP,
  isCDPAvailable,
  type FetchMode,
  type OutputFormat,
  isPreapprovedUrl,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z.string().describe('The prompt to run on the fetched content'),
    mode: z
      .enum(['auto', 'web', 'twitter', 'wechat'])
      .optional()
      .describe(
        'Fetch mode: auto (auto-detect), web (generic webpage), twitter (X/Twitter), wechat (WeChat articles). Defaults to auto.',
      ),
    format: z
      .enum(['markdown', 'json', 'text'])
      .optional()
      .describe(
        'Output format: markdown (default), json (structured data), text (human-readable). For Twitter/X content, json returns raw API response.',
      ),
    skipJina: z
      .boolean()
      .optional()
      .describe(
        'Skip Jina Reader and use direct fetching. Useful when Jina fails for certain sites.',
      ),
    pretty: z
      .boolean()
      .optional()
      .describe(
        'Pretty-print JSON output (only applies when format is json).',
      ),
    textOnly: z
      .boolean()
      .optional()
      .describe(
        'Return human-readable text instead of markdown (Twitter/X only).',
      ),
    wechatApiUrl: z
      .string()
      .optional()
      .describe(
        'WeChat article exporter API URL (e.g., http://localhost:3000). If set, uses this service for WeChat articles.',
      ),
    useCDP: z
      .boolean()
      .optional()
      .describe(
        'Use Chrome DevTools Protocol (CDP) to fetch content. Required for JavaScript-rendered pages like Xiaohongshu (小红书), Single-page apps, and sites with anti-bot protection. Auto-fallback to CDP when static fetch returns insufficient content.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    bytes: z.number().describe('Size of the fetched content in bytes'),
    code: z.number().describe('HTTP response code'),
    codeText: z.string().describe('HTTP response code text'),
    result: z
      .string()
      .describe('Processed result from applying the prompt to the content'),
    durationMs: z
      .number()
      .describe('Time taken to fetch and process the content'),
    url: z.string().describe('The URL that was fetched'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function webFetchToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { url } = parsedInput.data
    const hostname = new URL(url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}

export const WebFetchTool = buildTool({
  name: WEB_FETCH_TOOL_NAME,
  searchHint: 'fetch and extract content from a URL',
  // 100K chars - tool result persistence threshold
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    const { url } = input as { url: string }
    try {
      const hostname = new URL(url).hostname
      return `Claude wants to fetch content from ${hostname}`
    } catch {
      return `Claude wants to fetch content from this URL`
    }
  },
  userFacingName() {
    return 'Fetch'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Fetching ${summary}` : 'Fetching web page'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.prompt ? `${input.url}: ${input.prompt}` : input.url
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    // Check if the hostname is in the preapproved list
    try {
      const { url } = input as { url: string }
      const parsedUrl = new URL(url)
      if (isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: { type: 'other', reason: 'Preapproved host' },
        }
      }
    } catch {
      // If URL parsing fails, continue with normal permission checks
    }

    // Check for a rule specific to the tool input (matching hostname)
    const ruleContent = webFetchToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${WebFetchTool.name} denied access to ${ruleContent}.`,
        decisionReason: {
          type: 'rule',
          rule: denyRule,
        },
      }
    }

    const askRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        suggestions: buildSuggestions(ruleContent),
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'rule',
          rule: allowRule,
        },
      }
    }

    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
      suggestions: buildSuggestions(ruleContent),
    }
  },
  async prompt(_options) {
    // Always include the auth warning regardless of whether ToolSearch is
    // currently in the tools list. Conditionally toggling this prefix based
    // on ToolSearch availability caused the tool description to flicker
    // between SDK query() calls (when ToolSearch enablement varies due to
    // MCP tool count thresholds), invalidating the Anthropic API prompt
    // cache on each toggle — two consecutive cache misses per flicker event.
    return `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.
${DESCRIPTION}`
  },
  async validateInput(input) {
    const { url } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Error: Invalid URL "${url}". The URL provided could not be parsed.`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(
    {
      url,
      prompt,
      mode = 'auto',
      format = 'markdown',
      skipJina,
      pretty,
      textOnly,
      wechatApiUrl,
      useCDP,
    },
    context,
  ) {
    const { abortController, options: { isNonInteractiveSession } } = context
    const start = Date.now()

    let fetchResult: { content: string; source: string; code: number; bytes: number }
    let usedCDP = false

    // Determine if we should use CDP
    const shouldUseCDP = useCDP === true
    const isAntiBotSite = /xiaohongshu\.com|xhslink\.com|weibo\.com|douyin\.com|tiktok\.com/i.test(url)

    if (shouldUseCDP || isAntiBotSite) {
      // Try CDP first if explicitly requested or site is known anti-bot
      const cdpAvailable = await isCDPAvailable()
      if (cdpAvailable) {
        try {
          fetchResult = await fetchViaCDP(url, abortController.signal, {
            scrollToBottom: true,
          })
          usedCDP = true
        } catch (err) {
          if (shouldUseCDP) {
            // User explicitly requested CDP but it failed
            throw err
          }
          // Otherwise fall through to regular fetch
        }
      } else if (shouldUseCDP) {
        // Get more detailed error by trying to check CDP availability
        const cdpCheck = await isCDPAvailable()
        if (!cdpCheck) {
          throw new Error(
            'CDP mode requested but CDP is not available.\n' +
            'Current Chrome remote-debugging-port: 37741 (detected from DevToolsActivePort)\n' +
            'Please ensure Chrome is running with --remote-debugging-port=9222',
          )
        }
      }
    }

    // Use regular fetch if CDP wasn't used or failed
    if (!fetchResult!) {
      fetchResult = await fetchContent(url, abortController.signal, {
        mode: mode as FetchMode,
        format: format as OutputFormat,
        skipJina,
        pretty,
        textOnly,
        wechatApiUrl,
      })

      // Auto-fallback to CDP if content seems insufficient (likely bot protection)
      if (!useCDP && !usedCDP) {
        const contentLower = fetchResult.content.toLowerCase()
        const isInsufficient =
          fetchResult.content.length < 500 ||
          contentLower.includes('请开启javascript') ||
          contentLower.includes('please enable javascript') ||
          contentLower.includes('需要登录') ||
          contentLower.includes('请登录') ||
          contentLower.includes('verification') ||
          contentLower.includes('captcha') ||
          (contentLower.includes('footer') && contentLower.includes('privacy') && fetchResult.content.length < 1000)

        if (isInsufficient) {
          const cdpAvailable = await isCDPAvailable()
          if (cdpAvailable) {
            try {
              const cdpResult = await fetchViaCDP(url, abortController.signal, {
                scrollToBottom: true,
              })
              // Use CDP result if it's significantly better
              if (cdpResult.content.length > fetchResult.content.length * 1.5) {
                fetchResult = cdpResult
                usedCDP = true
              }
            } catch {
              // CDP fallback failed, keep original result
            }
          }
        }
      }
    }

    const { content, source, code } = fetchResult
    const isPreapproved = isPreapprovedUrl(url)

    // For JSON format or when user explicitly wants raw content, skip prompt processing
    let result: string
    if (format === 'json' || (prompt === 'raw' || prompt === '')) {
      result = content
    } else {
      // Apply user's prompt to the fetched content
      result = await applyPromptToMarkdown(
        prompt,
        content,
        abortController.signal,
        isNonInteractiveSession,
        isPreapproved,
      )
    }

    const output: Output = {
      bytes: fetchResult.bytes,
      code,
      codeText: usedCDP ? 'CDP' : source,
      result,
      durationMs: Date.now() - start,
      url,
    }

    return {
      data: output,
    }
  },
  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function buildSuggestions(ruleContent: string): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: WEB_FETCH_TOOL_NAME, ruleContent }],
      behavior: 'allow',
    },
  ]
}
