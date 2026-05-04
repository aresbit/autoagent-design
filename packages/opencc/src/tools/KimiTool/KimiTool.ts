import path from 'path'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'

const KIMI_TOOL_NAME = 'kimitool'
const MODEL_NAME = 'kimi'
const ACCESS_TOKEN_EXPIRES = 300
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_RETRY_COUNT = 3
const RETRY_DELAY_MS = 1200
const KIMI_CONFIG_PATH = path.join(homedir(), '.claude', 'kimi.json')

const pickTokenInputSchema = z.strictObject({
  action: z.literal('pick_token'),
  authorization: z
    .string()
    .describe('Authorization header value, e.g. "Bearer TOKEN1,TOKEN2"'),
})

const buildHeaderInputSchema = z.strictObject({
  action: z.literal('build_auth_header'),
  authorization: z
    .string()
    .describe('Authorization header value, e.g. "Bearer TOKEN1,TOKEN2"'),
})

const checkTokenInputSchema = z.strictObject({
  action: z.literal('check_token_live'),
  token: z
    .string()
    .describe('Kimi refresh_token, optionally prefixed with "Bearer "'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(15000)
    .describe('Timeout in milliseconds for live check request'),
})

const fromCdpSessionInputSchema = z.strictObject({
  action: z.literal('from_cdp_session'),
  target: z
    .string()
    .optional()
    .describe('Optional CDP target prefix from `cdp list`; if omitted, auto-detect kimi tab'),
  localStorageKey: z
    .string()
    .default('refresh_token')
    .describe('localStorage key to read; default is refresh_token'),
})

const loadConfigInputSchema = z.strictObject({
  action: z.literal('load_config'),
})

const saveConfigInputSchema = z.strictObject({
  action: z.literal('save_config'),
  authorization: z
    .string()
    .describe('Authorization header or token list to persist into ~/.claude/kimi.json'),
})

const chatCompletionInputSchema = z.strictObject({
  action: z.literal('chat_completion'),
  authorization: z
    .string()
    .optional()
    .describe('Authorization header with one or multiple refresh_tokens'),
  model: z.string().default(MODEL_NAME),
  messages: z
    .array(z.any())
    .min(1)
    .describe('OpenAI-compatible chat messages array'),
  use_search: z.boolean().default(true),
  conversation_id: z
    .string()
    .optional()
    .describe('Optional Kimi conversation id for native multi-turn continuation'),
  cleanup_conversation: z
    .boolean()
    .default(true)
    .describe('Remove temporary conversation after completion when conversation_id is not provided'),
})

const chatCompletionStreamInputSchema = z.strictObject({
  action: z.literal('chat_completion_stream'),
  authorization: z
    .string()
    .optional()
    .describe('Authorization header with one or multiple refresh_tokens'),
  model: z.string().default(MODEL_NAME),
  messages: z
    .array(z.any())
    .min(1)
    .describe('OpenAI-compatible chat messages array'),
  use_search: z.boolean().default(true),
  conversation_id: z
    .string()
    .optional()
    .describe('Optional Kimi conversation id for native multi-turn continuation'),
  cleanup_conversation: z
    .boolean()
    .default(true)
    .describe('Remove temporary conversation after completion when conversation_id is not provided'),
})

const inputSchema = lazySchema(() =>
  z.discriminatedUnion('action', [
    pickTokenInputSchema,
    buildHeaderInputSchema,
    checkTokenInputSchema,
    fromCdpSessionInputSchema,
    loadConfigInputSchema,
    saveConfigInputSchema,
    chatCompletionInputSchema,
    chatCompletionStreamInputSchema,
  ]),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

type OpenAIChoice = {
  index: number
  message: {
    role: 'assistant'
    content: string
  }
  finish_reason: 'stop'
}

const chatCompletionOutputSchema = z.object({
  action: z.literal('chat_completion'),
  id: z.string(),
  model: z.string(),
  object: z.literal('chat.completion'),
  choices: z.array(
    z.object({
      index: z.number().int(),
      message: z.object({
        role: z.literal('assistant'),
        content: z.string(),
      }),
      finish_reason: z.literal('stop'),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
  }),
  created: z.number().int(),
  selectedToken: z.string(),
})

const chatCompletionStreamOutputSchema = z.object({
  action: z.literal('chat_completion_stream'),
  id: z.string(),
  model: z.string(),
  object: z.literal('chat.completion.chunked_result'),
  chunks: z.array(z.string()),
  finalContent: z.string(),
  usage: z.object({
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
  }),
  created: z.number().int(),
  selectedToken: z.string(),
})

const pickTokenOutputSchema = z.object({
  action: z.literal('pick_token'),
  tokenCount: z.number().int(),
  selectedToken: z.string(),
  normalizedAuthorization: z.string(),
})

const buildHeaderOutputSchema = z.object({
  action: z.literal('build_auth_header'),
  tokenCount: z.number().int(),
  authorization: z.string(),
})

const checkTokenOutputSchema = z.object({
  action: z.literal('check_token_live'),
  live: z.boolean(),
  status: z.number().int().optional(),
  message: z.string(),
})

const fromCdpSessionOutputSchema = z.object({
  action: z.literal('from_cdp_session'),
  ok: z.boolean(),
  source: z.enum(['localStorage', 'cookie', 'none']),
  target: z.string().optional(),
  token: z.string().optional(),
  authorization: z.string().optional(),
  message: z.string(),
})

const loadConfigOutputSchema = z.object({
  action: z.literal('load_config'),
  ok: z.boolean(),
  source: z.enum(['env', 'file', 'none']),
  tokenCount: z.number().int(),
  authorization: z.string().optional(),
  path: z.string(),
  message: z.string(),
})

const saveConfigOutputSchema = z.object({
  action: z.literal('save_config'),
  ok: z.boolean(),
  path: z.string(),
  tokenCount: z.number().int(),
  authorization: z.string(),
  message: z.string(),
})

const outputSchema = lazySchema(() =>
  z.union([
    pickTokenOutputSchema,
    buildHeaderOutputSchema,
    checkTokenOutputSchema,
    fromCdpSessionOutputSchema,
    loadConfigOutputSchema,
    saveConfigOutputSchema,
    chatCompletionOutputSchema,
    chatCompletionStreamOutputSchema,
  ]),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

type AccessTokenState = {
  userId: string
  accessToken: string
  refreshToken: string
  refreshTime: number
}

const accessTokenMap = new Map<string, AccessTokenState>()
const accessTokenRequestMap = new Map<string, Promise<AccessTokenState>>()

const FAKE_HEADERS = {
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Origin: 'https://kimi.moonshot.cn',
  'R-Timezone': 'Asia/Shanghai',
  'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isAuthLikeError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? '')
  return (
    message.includes('401') ||
    message.includes('auth.token.invalid') ||
    message.includes('token invalid') ||
    message.includes('API request failed')
  )
}

function shuffleTokens(tokens: string[]): string[] {
  const result = [...tokens]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j] as string, result[i] as string]
  }
  return result
}

function randomDigits(length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) {
    s += Math.floor(Math.random() * 10).toString()
  }
  return s
}

function randomId(length: number): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < length; i++) {
    s += chars[Math.floor(Math.random() * chars.length)]
  }
  return s
}

function generateCookie(): string {
  const now = unixTimestamp()
  const offset = () => now - Math.round(Math.random() * 2592000)
  return [
    `Hm_lvt_358cae4815e85d48f7e8ab7f3680a74b=${offset()}`,
    `_ga=GA1.1.${randomDigits(10)}.${offset()}`,
    `_ga_YXD8W70SZP=GS1.1.${offset()}.1.1.${offset()}.0.0.0`,
    `Hm_lpvt_358cae4815e85d48f7e8ab7f3680a74b=${offset()}`,
  ].join('; ')
}

function stripBearerPrefix(value: string): string {
  return value.replace(/^Bearer\s+/i, '').trim()
}

function tokenSplit(authorization: string): string[] {
  return stripBearerPrefix(authorization)
    .split(',')
    .map(token => token.trim())
    .filter(Boolean)
}

function assertTokens(tokens: string[]): void {
  if (!tokens.length) {
    throw new Error('No token found in authorization input')
  }
}

function selectRandomToken(tokens: string[]): string {
  if (!tokens.length) {
    throw new Error('No token found in authorization input')
  }
  return tokens[Math.floor(Math.random() * tokens.length)] as string
}

function normalizeAuthorization(tokens: string[]): string {
  return `Bearer ${tokens.join(',')}`
}

function parseTokensFromUnknown(input: string): string[] {
  return tokenSplit(input)
}

function loadTokensFromConfigFile(): string[] {
  if (!existsSync(KIMI_CONFIG_PATH)) return []
  const raw = readFileSync(KIMI_CONFIG_PATH, 'utf-8')
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as Record<string, unknown>

  const auth = obj.authorization
  if (typeof auth === 'string') {
    return parseTokensFromUnknown(auth)
  }

  const refreshTokens = obj.refresh_tokens
  if (Array.isArray(refreshTokens)) {
    return refreshTokens.map(v => String(v).trim()).filter(Boolean)
  }
  if (typeof refreshTokens === 'string') {
    return parseTokensFromUnknown(refreshTokens)
  }

  const token = obj.token
  if (typeof token === 'string') {
    return parseTokensFromUnknown(token)
  }

  return []
}

function loadTokensFromEnv(): string[] {
  const raw = process.env.KIMI_REFRESH_TOKENS
  if (!raw || !raw.trim()) return []
  return parseTokensFromUnknown(raw)
}

function resolveAuthorizationInput(authorization?: string): {
  tokens: string[]
  authorization: string
  source: 'input' | 'env' | 'file'
} {
  if (authorization && authorization.trim()) {
    const tokens = parseTokensFromUnknown(authorization)
    assertTokens(tokens)
    return { tokens, authorization: normalizeAuthorization(tokens), source: 'input' }
  }

  const envTokens = loadTokensFromEnv()
  if (envTokens.length) {
    return {
      tokens: envTokens,
      authorization: normalizeAuthorization(envTokens),
      source: 'env',
    }
  }

  const fileTokens = loadTokensFromConfigFile()
  if (fileTokens.length) {
    return {
      tokens: fileTokens,
      authorization: normalizeAuthorization(fileTokens),
      source: 'file',
    }
  }

  throw new Error(
    'No authorization provided and no token found in KIMI_REFRESH_TOKENS or ~/.claude/kimi.json',
  )
}

function saveKimiConfig(authorizationInput: string): {
  path: string
  tokenCount: number
  authorization: string
} {
  const tokens = parseTokensFromUnknown(authorizationInput)
  assertTokens(tokens)
  const authorization = normalizeAuthorization(tokens)
  const dir = path.dirname(KIMI_CONFIG_PATH)
  mkdirSync(dir, { recursive: true })
  const payload = {
    authorization,
    refresh_tokens: tokens,
    updated_at: new Date().toISOString(),
  }
  writeFileSync(KIMI_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf-8')
  return { path: KIMI_CONFIG_PATH, tokenCount: tokens.length, authorization }
}

function isBase64Data(value: string): boolean {
  return /^data:/.test(value)
}

function extractBase64Format(value: string): string | null {
  const match = value.trim().match(/^data:(.+);base64,/)
  return match ? match[1] : null
}

function removeBase64DataHeader(value: string): string {
  return value.replace(/^data:(.+);base64,/, '')
}

function guessExtFromMime(mime: string | null): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('gif')) return 'gif'
  if (m.includes('webp')) return 'webp'
  if (m.includes('txt')) return 'txt'
  if (m.includes('json')) return 'json'
  if (m.includes('md')) return 'md'
  return 'bin'
}

function guessMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.txt':
      return 'text/plain'
    case '.json':
      return 'application/json'
    case '.md':
      return 'text/markdown'
    default:
      return 'application/octet-stream'
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeout = 15000,
): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function runProcess(
  cmd: string,
  args: string[],
  timeoutMs = 20000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Process timeout: ${cmd} ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', d => {
      stdout += d.toString()
    })
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

function parseCdpListOutput(
  content: string,
): Array<{ prefix: string; url: string; raw: string }> {
  const lines = content
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)

  const rows: Array<{ prefix: string; url: string; raw: string }> = []
  for (const line of lines) {
    const match = line.match(/^([0-9a-fA-F]+)\s+.*\s+(https?:\/\/\S+)$/)
    if (!match) continue
    rows.push({ prefix: match[1] as string, url: match[2] as string, raw: line })
  }
  return rows
}

function normalizeRefreshTokenValue(raw: string): string | null {
  const value = raw.trim()
  if (!value || value === '__OPENCC_NULL__') return null

  if (
    (value.startsWith('[') && value.endsWith(']')) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        const items = parsed.map(v => String(v).trim()).filter(Boolean)
        return items.length ? items.join('.') : null
      }
      if (typeof parsed === 'string') {
        const s = parsed.trim()
        return s || null
      }
    } catch {
      // fallback to plain string path
    }
  }

  return value
}

function parseRefreshTokenFromCookie(cookieText: string): string | null {
  if (!cookieText.trim()) return null
  const entries = cookieText.split(';').map(v => v.trim())
  for (const entry of entries) {
    const idx = entry.indexOf('=')
    if (idx <= 0) continue
    const k = entry.slice(0, idx)
    const v = entry.slice(idx + 1)
    if (k !== 'refresh_token') continue
    try {
      const decoded = decodeURIComponent(v)
      return normalizeRefreshTokenValue(decoded)
    } catch {
      return normalizeRefreshTokenValue(v)
    }
  }
  return null
}

async function readRefreshTokenFromCdpSession(input: {
  target?: string
  localStorageKey: string
}): Promise<{
  ok: boolean
  source: 'localStorage' | 'cookie' | 'none'
  target?: string
  token?: string
  authorization?: string
  message: string
}> {
  const cdpScriptPath = path.resolve(process.cwd(), 'scripts/cdp.mjs')

  const targetPrefix = input.target?.trim()
  let target = targetPrefix
  if (!target) {
    const listResult = await runProcess('bun', [cdpScriptPath, 'list'], 20000)
    if ((listResult.code ?? 1) !== 0) {
      throw new Error(
        `cdp list failed: ${(listResult.stderr || listResult.stdout).trim()}`,
      )
    }
    const rows = parseCdpListOutput(listResult.stdout)
    const kimiRow = rows.find(
      row =>
        row.url.includes('kimi.com') ||
        row.url.includes('kimi.moonshot.cn') ||
        row.url.includes('moonshot.cn'),
    )
    if (!kimiRow) {
      return {
        ok: false,
        source: 'none',
        message:
          'No kimi.com or kimi.moonshot.cn tab found in Chrome. Open Kimi web first, then retry.',
      }
    }
    target = kimiRow.prefix
  }

  const localStorageExpr = `(() => {
    const v = window.localStorage.getItem(${JSON.stringify(input.localStorageKey)});
    return v == null ? "__OPENCC_NULL__" : v;
  })()`

  const localResult = await runProcess(
    'bun',
    [cdpScriptPath, 'eval', target, localStorageExpr],
    20000,
  )
  if ((localResult.code ?? 1) === 0) {
    const token = normalizeRefreshTokenValue(localResult.stdout)
    if (token) {
      return {
        ok: true,
        source: 'localStorage',
        target,
        token,
        authorization: `Bearer ${token}`,
        message: `refresh_token loaded from localStorage(${input.localStorageKey})`,
      }
    }
  }

  const cookieResult = await runProcess(
    'bun',
    [cdpScriptPath, 'eval', target, 'document.cookie'],
    20000,
  )
  if ((cookieResult.code ?? 1) === 0) {
    const token = parseRefreshTokenFromCookie(cookieResult.stdout)
    if (token) {
      return {
        ok: true,
        source: 'cookie',
        target,
        token,
        authorization: `Bearer ${token}`,
        message: 'refresh_token loaded from document.cookie',
      }
    }
  }

  return {
    ok: false,
    source: 'none',
    target,
    message:
      'refresh_token not found in localStorage/cookie for current CDP session',
  }
}

function checkResult(response: Response, data: unknown, refreshToken: string): any {
  if (response.status === 401) {
    accessTokenMap.delete(refreshToken)
    throw new Error('API request failed (401)')
  }
  if (!data || typeof data !== 'object') {
    return data
  }

  const payload = data as Record<string, unknown>
  const errorType = payload.error_type
  const message = payload.message
  if (typeof errorType !== 'string') {
    return payload
  }

  if (errorType === 'auth.token.invalid') {
    accessTokenMap.delete(refreshToken)
  }
  if (errorType === 'chat.user_stream_pushing') {
    throw new Error('已有对话流正在输出')
  }

  throw new Error(`[请求kimi失败]: ${typeof message === 'string' ? message : errorType}`)
}

async function requestToken(refreshToken: string): Promise<AccessTokenState> {
  const pending = accessTokenRequestMap.get(refreshToken)
  if (pending) {
    return pending
  }

  const created = (async () => {
    const response = await fetchWithTimeout(
      'https://kimi.moonshot.cn/api/auth/token/refresh',
      {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Authorization: `Bearer ${refreshToken}`,
          'Cache-Control': 'no-cache',
          Cookie: generateCookie(),
          Pragma: 'no-cache',
          Referer: 'https://kimi.moonshot.cn/',
          'Sec-Ch-Ua':
            '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      },
      15000,
    )

    const json = await parseJsonSafe(response)
    const checked = checkResult(response, json, refreshToken)
    const accessToken = checked?.access_token as string
    const refreshedToken = checked?.refresh_token as string

    const userInfo = await getUserInfo(accessToken, refreshToken)
    const userId = userInfo?.id as string

    return {
      userId,
      accessToken,
      refreshToken: refreshedToken,
      refreshTime: unixTimestamp() + ACCESS_TOKEN_EXPIRES,
    } satisfies AccessTokenState
  })().finally(() => {
    accessTokenRequestMap.delete(refreshToken)
  })

  accessTokenRequestMap.set(refreshToken, created)
  return created
}

async function acquireToken(refreshToken: string): Promise<AccessTokenState> {
  let tokenState = accessTokenMap.get(refreshToken)
  if (!tokenState || unixTimestamp() > tokenState.refreshTime) {
    tokenState = await requestToken(refreshToken)
    accessTokenMap.set(refreshToken, tokenState)
  }
  return tokenState
}

async function getUserInfo(accessToken: string, refreshToken: string): Promise<any> {
  const response = await fetchWithTimeout(
    'https://kimi.moonshot.cn/api/user',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Referer: 'https://kimi.moonshot.cn/',
        'X-Traffic-Id': `7${randomDigits(18)}`,
        Cookie: generateCookie(),
        ...FAKE_HEADERS,
      },
    },
    15000,
  )

  const json = await parseJsonSafe(response)
  return checkResult(response, json, refreshToken)
}

async function createConversation(name: string, refreshToken: string): Promise<string> {
  const { accessToken, userId } = await acquireToken(refreshToken)
  const response = await fetchWithTimeout(
    'https://kimi.moonshot.cn/api/chat',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Referer: 'https://kimi.moonshot.cn/',
        'X-Traffic-Id': userId,
        Cookie: generateCookie(),
        ...FAKE_HEADERS,
      },
      body: JSON.stringify({ is_example: false, name }),
    },
    15000,
  )

  const json = await parseJsonSafe(response)
  const data = checkResult(response, json, refreshToken)
  return data?.id as string
}

async function removeConversation(convId: string, refreshToken: string): Promise<void> {
  const { accessToken, userId } = await acquireToken(refreshToken)
  const response = await fetchWithTimeout(
    `https://kimi.moonshot.cn/api/chat/${convId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Referer: `https://kimi.moonshot.cn/chat/${convId}`,
        'X-Traffic-Id': userId,
        Cookie: generateCookie(),
        ...FAKE_HEADERS,
      },
    },
    15000,
  )

  const json = await parseJsonSafe(response)
  checkResult(response, json, refreshToken)
}

async function promptSnippetSubmit(query: string, refreshToken: string): Promise<void> {
  const { accessToken, userId } = await acquireToken(refreshToken)
  const response = await fetchWithTimeout(
    'https://kimi.moonshot.cn/api/prompt-snippet/instance',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Referer: 'https://kimi.moonshot.cn/',
        'X-Traffic-Id': userId,
        Cookie: generateCookie(),
        ...FAKE_HEADERS,
      },
      body: JSON.stringify({
        offset: 0,
        size: 10,
        query: query.replace('user:', '').replace('assistant:', ''),
      }),
    },
    15000,
  )

  const json = await parseJsonSafe(response)
  checkResult(response, json, refreshToken)
}

async function fakeRequest(refreshToken: string): Promise<void> {
  const { accessToken, userId } = await acquireToken(refreshToken)
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Referer: 'https://kimi.moonshot.cn/',
    'X-Traffic-Id': userId,
    Cookie: generateCookie(),
    ...FAKE_HEADERS,
  }

  const calls: Array<() => Promise<Response>> = [
    () => fetch('https://kimi.moonshot.cn/api/user', { method: 'GET', headers }),
    () =>
      fetch('https://kimi.moonshot.cn/api/chat_1m/user/status', {
        method: 'GET',
        headers,
      }),
    () =>
      fetch('https://kimi.moonshot.cn/api/chat/list', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: 0, size: 50 }),
      }),
    () =>
      fetch('https://kimi.moonshot.cn/api/show_case/list', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: 0,
          size: 4,
          enable_cache: true,
          order: 'asc',
        }),
      }),
  ]

  const fn = calls[Math.floor(Math.random() * calls.length)]
  await fn()
}

function wrapUrlsToTags(content: string): string {
  return content.replace(
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi,
    url => `<url id="" type="url" status="" title="" wc="">${url}</url>`,
  )
}

function extractRefFileUrls(messages: any[]): string[] {
  const urls: string[] = []
  if (!Array.isArray(messages) || !messages.length) {
    return urls
  }

  const lastMessage = messages[messages.length - 1]
  if (Array.isArray(lastMessage?.content)) {
    for (const item of lastMessage.content) {
      if (!item || typeof item !== 'object') continue
      const t = (item as Record<string, unknown>).type
      if (t === 'file') {
        const fileUrl = (item as any).file_url?.url
        if (typeof fileUrl === 'string') urls.push(fileUrl)
      } else if (t === 'image_url') {
        const imageUrl = (item as any).image_url?.url
        if (typeof imageUrl === 'string') urls.push(imageUrl)
      }
    }
  }

  return urls
}

function messagesPrepare(inputMessages: any[], isRefConv = false): Array<{ role: 'user'; content: string }> {
  const messages = JSON.parse(JSON.stringify(inputMessages)) as any[]
  let content = ''

  if (isRefConv || messages.length < 2) {
    content = messages.reduce((acc, message) => {
      if (Array.isArray(message?.content)) {
        return message.content.reduce((innerAcc: string, part: any) => {
          if (!part || typeof part !== 'object' || part.type !== 'text') return innerAcc
          return `${innerAcc}${part.text || ''}\n`
        }, acc)
      }
      const text = String(message?.content ?? '')
      return `${acc}${message?.role === 'user' ? wrapUrlsToTags(text) : text}\n`
    }, '')
  } else {
    const latest = messages[messages.length - 1]
    const hasFileOrImage =
      Array.isArray(latest?.content) &&
      latest.content.some(
        (part: any) => part && typeof part === 'object' && ['file', 'image_url'].includes(part.type),
      )

    messages.splice(messages.length - 1, 0, {
      role: 'system',
      content: hasFileOrImage ? '关注用户最新发送文件和消息' : '关注用户最新的消息',
    })

    content = messages.reduce((acc, message) => {
      if (Array.isArray(message?.content)) {
        return message.content.reduce((innerAcc: string, part: any) => {
          if (!part || typeof part !== 'object' || part.type !== 'text') return innerAcc
          return `${innerAcc}${message.role || 'user'}:${part.text || ''}\n`
        }, acc)
      }
      const raw = String(message?.content ?? '')
      const text = message?.role === 'user' ? wrapUrlsToTags(raw) : raw
      return `${acc}${message?.role || 'user'}:${text}\n`
    }, '')
  }

  return [{ role: 'user', content }]
}

async function preSignUrl(filename: string, refreshToken: string): Promise<any> {
  const { accessToken, userId } = await acquireToken(refreshToken)
  const response = await fetchWithTimeout(
    'https://kimi.moonshot.cn/api/pre-sign-url',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Referer: 'https://kimi.moonshot.cn/',
        'X-Traffic-Id': userId,
        Cookie: generateCookie(),
        ...FAKE_HEADERS,
      },
      body: JSON.stringify({ action: 'file', name: filename }),
    },
    15000,
  )

  const json = await parseJsonSafe(response)
  return checkResult(response, json, refreshToken)
}

async function checkFileUrl(fileUrl: string): Promise<void> {
  if (isBase64Data(fileUrl)) return

  const headResponse = await fetchWithTimeout(
    fileUrl,
    {
      method: 'HEAD',
    },
    15000,
  )

  if (headResponse.status >= 400) {
    throw new Error(`File ${fileUrl} is not valid: [${headResponse.status}]`)
  }

  const len = headResponse.headers.get('content-length')
  if (len) {
    const fileSize = Number.parseInt(len, 10)
    if (Number.isFinite(fileSize) && fileSize > MAX_FILE_SIZE) {
      throw new Error(`File ${fileUrl} exceeds max size`)
    }
  }
}

async function uploadFile(fileUrl: string, refreshToken: string): Promise<string> {
  await checkFileUrl(fileUrl)

  let filename = ''
  let fileData: Uint8Array
  let mimeType: string | null = null

  if (isBase64Data(fileUrl)) {
    mimeType = extractBase64Format(fileUrl)
    const ext = guessExtFromMime(mimeType)
    filename = `${randomId(24)}.${ext}`
    fileData = Uint8Array.from(Buffer.from(removeBase64DataHeader(fileUrl), 'base64'))
  } else {
    filename = path.basename(new URL(fileUrl).pathname) || `${randomId(24)}.bin`
    const response = await fetchWithTimeout(fileUrl, { method: 'GET' }, 60000)
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`)
    }
    const ab = await response.arrayBuffer()
    if (ab.byteLength > MAX_FILE_SIZE) {
      throw new Error(`File ${fileUrl} exceeds max size`)
    }
    fileData = new Uint8Array(ab)
  }

  const { url: uploadUrl, object_name: objectName } = await preSignUrl(
    filename,
    refreshToken,
  )

  const { accessToken, userId } = await acquireToken(refreshToken)

  mimeType = mimeType || guessMimeFromFilename(filename)
  const uploadResponse = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        Authorization: `Bearer ${accessToken}`,
        Referer: 'https://kimi.moonshot.cn/',
        'X-Traffic-Id': userId,
        Cookie: generateCookie(),
        ...FAKE_HEADERS,
      },
      body: fileData,
    },
    120000,
  )

  if (uploadResponse.status >= 400) {
    throw new Error(`Upload file failed: ${uploadResponse.status}`)
  }

  let fileId = ''
  let status = ''
  const initDeadline = Date.now() + 30000
  while (status !== 'initialized') {
    if (Date.now() > initDeadline) {
      throw new Error('文件等待处理超时')
    }

    const response = await fetchWithTimeout(
      'https://kimi.moonshot.cn/api/file',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Referer: 'https://kimi.moonshot.cn/',
          'X-Traffic-Id': userId,
          Cookie: generateCookie(),
          ...FAKE_HEADERS,
        },
        body: JSON.stringify({
          type: 'file',
          name: filename,
          object_name: objectName,
          timeout: 15000,
        }),
      },
      15000,
    )

    const json = await parseJsonSafe(response)
    const data = checkResult(response, json, refreshToken)
    fileId = data?.id as string
    status = data?.status as string

    if (status !== 'initialized') {
      await sleep(300)
    }
  }

  const parseDeadline = Date.now() + 30000
  while (true) {
    if (Date.now() > parseDeadline) {
      throw new Error('文件等待处理超时')
    }

    try {
      const response = await fetchWithTimeout(
        'https://kimi.moonshot.cn/api/file/parse_process',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Referer: 'https://kimi.moonshot.cn/',
            'X-Traffic-Id': userId,
            Cookie: generateCookie(),
            ...FAKE_HEADERS,
          },
          body: JSON.stringify({ ids: [fileId], timeout: 120000 }),
        },
        15000,
      )

      if (response.ok) {
        break
      }
    } catch {
      // retry
    }

    await sleep(300)
  }

  return fileId
}

type StreamParseResult = {
  content: string
  chunks: string[]
}

async function parseKimiEventStream(
  response: Response,
  model: string,
): Promise<StreamParseResult> {
  const reader = response.body?.getReader()
  if (!reader) {
    return { content: '', chunks: [] }
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const chunks: string[] = []
  let refContent = ''
  const silentSearch = model.includes('silent_search')

  const applyEvent = (rawEvent: string) => {
    const dataLines = rawEvent
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())

    if (!dataLines.length) return

    const dataText = dataLines.join('\n')
    if (dataText === '[DONE]') return

    let result: any
    try {
      result = JSON.parse(dataText)
    } catch {
      return
    }

    if (result?.event === 'cmpl' && typeof result.text === 'string') {
      const exceptCharIndex = result.text.indexOf('�')
      const chunk = result.text.substring(
        0,
        exceptCharIndex === -1 ? result.text.length : exceptCharIndex,
      )
      content += chunk
      chunks.push(chunk)
      return
    }
    if (
      !silentSearch &&
      result?.event === 'search_plus' &&
      result?.msg?.type === 'get_res'
    ) {
      refContent += `${result.msg.title} - ${result.msg.url}\n`
      return
    }
    if (result?.event === 'all_done' || result?.event === 'error') {
      if (result?.event === 'error') {
        content += '\n[内容由于不合规被停止生成，我们换个话题吧]'
      }
      if (refContent) {
        content += `\n\n搜索结果来自：\n${refContent}`
        refContent = ''
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    while (true) {
      const sepIdx = buffer.indexOf('\n\n')
      if (sepIdx === -1) break

      const rawEvent = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)
      applyEvent(rawEvent)
    }
  }

  const leftover = buffer.trim()
  if (leftover) {
    applyEvent(leftover)
  }

  if (refContent) {
    content += `\n\n搜索结果来自：\n${refContent}`
  }

  return { content, chunks }
}

async function createCompletion(
  model: string,
  messages: any[],
  refreshToken: string,
  useSearch: boolean,
  refConvId?: string,
  cleanupConversation = true,
): Promise<{ id: string; model: string; object: 'chat.completion'; choices: OpenAIChoice[]; usage: { prompt_tokens: 1; completion_tokens: 1; total_tokens: 2 }; created: number }> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY_COUNT; attempt++) {
    try {
      const refFileUrls = extractRefFileUrls(messages)
      const refs = refFileUrls.length
        ? await Promise.all(
            refFileUrls.map(fileUrl => uploadFile(fileUrl, refreshToken)),
          )
        : []

      void fakeRequest(refreshToken).catch(() => {})

      const convId =
        typeof refConvId === 'string' && /^[0-9a-zA-Z]{20}$/.test(refConvId)
          ? refConvId
          : await createConversation('未命名会话', refreshToken)

      const { accessToken, userId } = await acquireToken(refreshToken)
      const sendMessages = messagesPrepare(messages, !!refConvId)

      const response = await fetchWithTimeout(
        `https://kimi.moonshot.cn/api/chat/${convId}/completion/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Referer: `https://kimi.moonshot.cn/chat/${convId}`,
            Priority: 'u=1, i',
            'X-Traffic-Id': userId,
            Cookie: generateCookie(),
            ...FAKE_HEADERS,
          },
          body: JSON.stringify({
            messages: sendMessages,
            refs,
            use_search: useSearch,
          }),
        },
        300000,
      )

      if (!response.ok) {
        const json = await parseJsonSafe(response)
        checkResult(response, json, refreshToken)
        throw new Error(`kimi request failed: ${response.status}`)
      }

      const parsed = await parseKimiEventStream(response, model)

      if (!refConvId && cleanupConversation) {
        void removeConversation(convId, refreshToken).catch(() => {})
      }
      void promptSnippetSubmit(sendMessages[0].content, refreshToken).catch(
        () => {},
      )

      return {
        id: convId,
        model,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: parsed.content },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        created: unixTimestamp(),
      }
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRY_COUNT - 1) {
        if (isAuthLikeError(error)) {
          accessTokenMap.delete(refreshToken)
        }
        await sleep(RETRY_DELAY_MS)
        continue
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'kimi completion failed'))
}

async function createCompletionStreamResult(
  model: string,
  messages: any[],
  refreshToken: string,
  useSearch: boolean,
  refConvId?: string,
  cleanupConversation = true,
): Promise<{ id: string; model: string; object: 'chat.completion.chunked_result'; chunks: string[]; finalContent: string; usage: { prompt_tokens: 1; completion_tokens: 1; total_tokens: 2 }; created: number }> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY_COUNT; attempt++) {
    try {
      const refFileUrls = extractRefFileUrls(messages)
      const refs = refFileUrls.length
        ? await Promise.all(
            refFileUrls.map(fileUrl => uploadFile(fileUrl, refreshToken)),
          )
        : []

      void fakeRequest(refreshToken).catch(() => {})

      const convId =
        typeof refConvId === 'string' && /^[0-9a-zA-Z]{20}$/.test(refConvId)
          ? refConvId
          : await createConversation('未命名会话', refreshToken)

      const { accessToken, userId } = await acquireToken(refreshToken)
      const sendMessages = messagesPrepare(messages, !!refConvId)

      const response = await fetchWithTimeout(
        `https://kimi.moonshot.cn/api/chat/${convId}/completion/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Referer: `https://kimi.moonshot.cn/chat/${convId}`,
            Priority: 'u=1, i',
            'X-Traffic-Id': userId,
            Cookie: generateCookie(),
            ...FAKE_HEADERS,
          },
          body: JSON.stringify({
            messages: sendMessages,
            refs,
            use_search: useSearch,
          }),
        },
        300000,
      )

      if (!response.ok) {
        const json = await parseJsonSafe(response)
        checkResult(response, json, refreshToken)
        throw new Error(`kimi request failed: ${response.status}`)
      }

      const parsed = await parseKimiEventStream(response, model)

      if (!refConvId && cleanupConversation) {
        void removeConversation(convId, refreshToken).catch(() => {})
      }
      void promptSnippetSubmit(sendMessages[0].content, refreshToken).catch(
        () => {},
      )

      return {
        id: convId,
        model,
        object: 'chat.completion.chunked_result',
        chunks: parsed.chunks,
        finalContent: parsed.content,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        created: unixTimestamp(),
      }
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRY_COUNT - 1) {
        if (isAuthLikeError(error)) {
          accessTokenMap.delete(refreshToken)
        }
        await sleep(RETRY_DELAY_MS)
        continue
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'kimi stream completion failed'))
}

async function checkTokenLiveStatus(
  refreshTokenRaw: string,
  timeoutMs: number,
): Promise<{ live: boolean; status?: number; message: string }> {
  const refreshToken = stripBearerPrefix(refreshTokenRaw)
  if (!refreshToken) {
    return { live: false, message: 'token is empty' }
  }

  try {
    const response = await fetchWithTimeout(
      'https://kimi.moonshot.cn/api/auth/token/refresh',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${refreshToken}`,
          Referer: 'https://kimi.moonshot.cn/',
          Cookie: generateCookie(),
          ...FAKE_HEADERS,
        },
      },
      timeoutMs,
    )

    const payload = await parseJsonSafe(response)
    const data =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {}

    const hasAccessToken =
      typeof data.access_token === 'string' && data.access_token.length > 0
    const hasRefreshToken =
      typeof data.refresh_token === 'string' && data.refresh_token.length > 0

    if (response.status === 401) {
      return { live: false, status: 401, message: 'token invalid (401)' }
    }

    return hasAccessToken && hasRefreshToken
      ? { live: true, status: response.status, message: 'token is live' }
      : { live: false, status: response.status, message: 'token check failed' }
  } catch (error) {
    return {
      live: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export const KimiTool = buildTool({
  name: KIMI_TOOL_NAME,
  searchHint: 'kimi free-api compatible completion and token operations',
  maxResultSizeChars: 300_000,
  async description() {
    return 'Kimi web reverse API toolkit (compatible with kimi-free-api capabilities): token split/random selection, token live check, OpenAI-compatible chat completion, stream-like chunk result, file/image URL and base64 upload parsing, search toggle, and conversation continuation/cleanup.'
  },
  async prompt() {
    return 'Use KimiTool for kimi-free-api style operations. Supported actions: pick_token, build_auth_header, check_token_live, chat_completion, chat_completion_stream. For chat actions pass authorization with one or more refresh_tokens, plus messages/use_search/conversation_id.'
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
    return 'KimiTool'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `kimitool:${input.action}`
  },
  async call(input: Input) {
    switch (input.action) {
      case 'pick_token': {
        const tokens = tokenSplit(input.authorization)
        assertTokens(tokens)
        const selectedToken = selectRandomToken(tokens)
        return {
          data: {
            action: 'pick_token' as const,
            tokenCount: tokens.length,
            selectedToken,
            normalizedAuthorization: normalizeAuthorization(tokens),
          },
        }
      }
      case 'build_auth_header': {
        const tokens = tokenSplit(input.authorization)
        assertTokens(tokens)
        return {
          data: {
            action: 'build_auth_header' as const,
            tokenCount: tokens.length,
            authorization: normalizeAuthorization(tokens),
          },
        }
      }
      case 'check_token_live': {
        const result = await checkTokenLiveStatus(input.token, input.timeoutMs)
        return {
          data: {
            action: 'check_token_live' as const,
            live: result.live,
            status: result.status,
            message: result.message,
          },
        }
      }
      case 'from_cdp_session': {
        let result
        try {
          result = await readRefreshTokenFromCdpSession({
            target: input.target,
            localStorageKey: input.localStorageKey,
          })
        } catch (error) {
          result = {
            ok: false,
            source: 'none' as const,
            message: error instanceof Error ? error.message : String(error),
          }
        }
        return {
          data: {
            action: 'from_cdp_session' as const,
            ...result,
          },
        }
      }
      case 'save_config': {
        const saved = saveKimiConfig(input.authorization)
        return {
          data: {
            action: 'save_config' as const,
            ok: true,
            path: saved.path,
            tokenCount: saved.tokenCount,
            authorization: saved.authorization,
            message: 'Saved Kimi token config',
          },
        }
      }
      case 'load_config': {
        const envTokens = loadTokensFromEnv()
        if (envTokens.length) {
          return {
            data: {
              action: 'load_config' as const,
              ok: true,
              source: 'env' as const,
              tokenCount: envTokens.length,
              authorization: normalizeAuthorization(envTokens),
              path: KIMI_CONFIG_PATH,
              message: 'Loaded tokens from KIMI_REFRESH_TOKENS',
            },
          }
        }
        const fileTokens = loadTokensFromConfigFile()
        if (fileTokens.length) {
          return {
            data: {
              action: 'load_config' as const,
              ok: true,
              source: 'file' as const,
              tokenCount: fileTokens.length,
              authorization: normalizeAuthorization(fileTokens),
              path: KIMI_CONFIG_PATH,
              message: 'Loaded tokens from ~/.claude/kimi.json',
            },
          }
        }
        return {
          data: {
            action: 'load_config' as const,
            ok: false,
            source: 'none' as const,
            tokenCount: 0,
            path: KIMI_CONFIG_PATH,
            message:
              'No tokens found in KIMI_REFRESH_TOKENS or ~/.claude/kimi.json',
          },
        }
      }
      case 'chat_completion': {
        const resolved = resolveAuthorizationInput(input.authorization)
        const tokens = resolved.tokens
        const candidates = shuffleTokens(tokens)
        const maxAttempts = Math.max(MAX_RETRY_COUNT, candidates.length)
        let lastError: unknown
        let selectedToken = candidates[0] as string
        let result: Awaited<ReturnType<typeof createCompletion>> | null = null
        for (let i = 0; i < maxAttempts; i++) {
          selectedToken = candidates[i % candidates.length] as string
          try {
            result = await createCompletion(
              input.model,
              input.messages,
              selectedToken,
              input.use_search,
              input.conversation_id,
              input.cleanup_conversation,
            )
            break
          } catch (error) {
            lastError = error
            if (isAuthLikeError(error)) {
              accessTokenMap.delete(selectedToken)
            }
            if (i < maxAttempts - 1) {
              await sleep(RETRY_DELAY_MS)
            }
          }
        }
        if (!result) {
          throw lastError instanceof Error
            ? lastError
            : new Error(String(lastError ?? 'chat_completion failed'))
        }
        return {
          data: {
            action: 'chat_completion' as const,
            ...result,
            selectedToken,
          },
        }
      }
      case 'chat_completion_stream': {
        const resolved = resolveAuthorizationInput(input.authorization)
        const tokens = resolved.tokens
        const candidates = shuffleTokens(tokens)
        const maxAttempts = Math.max(MAX_RETRY_COUNT, candidates.length)
        let lastError: unknown
        let selectedToken = candidates[0] as string
        let result: Awaited<ReturnType<typeof createCompletionStreamResult>> | null =
          null
        for (let i = 0; i < maxAttempts; i++) {
          selectedToken = candidates[i % candidates.length] as string
          try {
            result = await createCompletionStreamResult(
              input.model,
              input.messages,
              selectedToken,
              input.use_search,
              input.conversation_id,
              input.cleanup_conversation,
            )
            break
          } catch (error) {
            lastError = error
            if (isAuthLikeError(error)) {
              accessTokenMap.delete(selectedToken)
            }
            if (i < maxAttempts - 1) {
              await sleep(RETRY_DELAY_MS)
            }
          }
        }
        if (!result) {
          throw lastError instanceof Error
            ? lastError
            : new Error(String(lastError ?? 'chat_completion_stream failed'))
        }
        return {
          data: {
            action: 'chat_completion_stream' as const,
            ...result,
            selectedToken,
          },
        }
      }
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const output = content as Output
    switch (output.action) {
      case 'pick_token':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Picked 1 token from ${output.tokenCount} token(s)`,
        }
      case 'build_auth_header':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Built Authorization header with ${output.tokenCount} token(s)`,
        }
      case 'check_token_live':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: output.live
            ? 'Kimi token is live'
            : `Kimi token is not live: ${output.message}`,
        }
      case 'from_cdp_session':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: output.ok
            ? `Loaded refresh_token from ${output.source}`
            : `Failed to load refresh_token: ${output.message}`,
        }
      case 'save_config':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Saved ${output.tokenCount} token(s) to ${output.path}`,
        }
      case 'load_config':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: output.ok
            ? `Loaded ${output.tokenCount} token(s) from ${output.source}`
            : output.message,
        }
      case 'chat_completion':
        const completionContent = output.choices[0]?.message?.content || 'No content';
        const maxDisplayChars = 50000;
        let displayContent = completionContent;
        let truncationNotice = '';
        if (completionContent.length > maxDisplayChars) {
          displayContent = completionContent.substring(0, maxDisplayChars);
          truncationNotice = `\n\n[内容过长，已截断前${maxDisplayChars}字符，完整内容共${completionContent.length}字符]`;
        }
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Kimi completion finished (conversation_id=${output.id})\n\n${displayContent}${truncationNotice}`,
        }
      case 'chat_completion_stream':
        const streamContent = output.finalContent || '';
        const maxDisplayCharsStream = 50000;
        let displayStreamContent = streamContent;
        let truncationNoticeStream = '';
        if (streamContent.length > maxDisplayCharsStream) {
          displayStreamContent = streamContent.substring(0, maxDisplayCharsStream);
          truncationNoticeStream = `\n\n[内容过长，已截断前${maxDisplayCharsStream}字符，完整内容共${streamContent.length}字符]`;
        }
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Kimi stream finished with ${output.chunks.length} chunk(s) (conversation_id=${output.id})\n\n${displayStreamContent}${truncationNoticeStream}`,
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
