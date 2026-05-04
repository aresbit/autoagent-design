import axios, { type AxiosResponse } from 'axios'
import { LRUCache } from 'lru-cache'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { queryHaiku } from '../../services/api/claude.js'
import { AbortError } from '../../utils/errors.js'
import { getWebFetchUserAgent } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import {
  isBinaryContentType,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { isPreapprovedHost } from './preapproved.js'
import { makeSecondaryModelPrompt } from './prompt.js'

// ============================================================================
// Fetch Strategy Types & Constants (from fetch-skill)
// ============================================================================

export type FetchMode = 'auto' | 'web' | 'twitter' | 'wechat'
export type OutputFormat = 'markdown' | 'json' | 'text'

const FXTWITTER_API = 'https://api.fxtwitter.com'
const JINA_READER_URL = 'https://r.jina.ai'
const DEFUDDLE_URL = 'https://defuddle.md'
const MARKDOWN_NEW_URL = 'https://markdown.new'

// Regex patterns for URL detection
const RE_TWITTER = /https?:\/\/(www\.)?(twitter|x)\.com\//i
const RE_TWEET = /https?:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\/(\d+)/i
const RE_ARTICLE = /https?:\/\/(www\.)?(twitter|x)\.com\/i\/(article|web\/article)\/(\d+)/i
const RE_WECHAT = /https?:\/\/mp\.weixin\.qq\.com\//i

// ============================================================================
// URL Detection (from fetch-skill)
// ============================================================================

export function detectFetchMode(url: string): FetchMode {
  if (RE_TWITTER.test(url)) return 'twitter'
  if (RE_WECHAT.test(url)) return 'wechat'
  return 'web'
}

export function isTwitterUrl(url: string): boolean {
  return RE_TWITTER.test(url)
}

export function isWechatUrl(url: string): boolean {
  return RE_WECHAT.test(url)
}

export function extractTweetId(url: string): string | null {
  const match = RE_TWEET.exec(url)
  return match ? match[3] : null
}

export function extractArticleId(url: string): string | null {
  const match = RE_ARTICLE.exec(url)
  return match ? match[3] : null
}

// ============================================================================
// DraftJS Parser for X Articles (from fetch-skill)
// ============================================================================

interface DraftJSRange {
  offset: number
  length: number
  style: string
}

interface DraftJSEntityRange {
  key: number
  offset: number
  length: number
}

interface DraftJSBlock {
  type: string
  text: string
  inlineStyleRanges: DraftJSRange[]
  entityRanges: DraftJSEntityRange[]
}

interface DraftJSEntity {
  key: number
  value: {
    type: string
    data: {
      caption?: string
      mediaItems?: { mediaId: string }[]
    }
  }
}

interface DraftJSContent {
  blocks: DraftJSBlock[]
  entityMap: DraftJSEntity[]
}

interface MediaEntity {
  media_id: string
  media_info: {
    original_img_url: string
  }
}

interface XArticle {
  title?: string
  content: DraftJSContent
  media_entities?: MediaEntity[]
}

function applyInlineStyles(text: string, ranges: DraftJSRange[]): string {
  if (!ranges || ranges.length === 0) return text

  const chars = text.split('')
  const opens: Record<number, string[]> = {}
  const closes: Record<number, string[]> = {}

  for (const r of [...ranges].sort((a, b) => a.offset - b.offset)) {
    const style = r.style
    const start = r.offset
    const end = r.offset + r.length
    const tag = style === 'BOLD' || style === 'Bold' ? '**' :
                style === 'ITALIC' || style === 'Italic' ? '*' : ''
    if (!tag) continue

    opens[start] = opens[start] || []
    opens[start].push(tag)
    closes[end] = closes[end] || []
    closes[end].unshift(tag)
  }

  const out: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (opens[i]) out.push(...opens[i]!)
    out.push(chars[i]!)
    if (closes[i]) out.push(...closes[i]!)
  }
  if (closes[chars.length]) out.push(...closes[chars.length]!)

  return out.join('')
}

export function parseDraftJSToMarkdown(article: XArticle): string {
  const content = article.content
  const blocks = content.blocks || []
  const entityList = content.entityMap || []
  const mediaEnts = article.media_entities || []

  // Build entity map: key -> entity value
  const entityMap: Record<string, DraftJSEntity['value']> = {}
  for (const ent of entityList) {
    entityMap[String(ent.key)] = ent.value
  }

  // Build media lookup: media_id -> original_img_url
  const mediaLookup: Record<string, string> = {}
  for (const me of mediaEnts) {
    const mid = String(me.media_id)
    const url = me.media_info?.original_img_url
    if (mid && url) mediaLookup[mid] = url
  }

  const title = article.title || ''
  const lines: string[] = title ? [`# ${title}`, ''] : []

  for (const block of blocks) {
    const btype = block.type || 'unstyled'
    const text = block.text || ''
    const ranges = block.inlineStyleRanges || []
    const eranges = block.entityRanges || []

    if (btype === 'atomic') {
      // Image block: resolve via entityRanges -> entityMap -> media_entities
      for (const er of eranges) {
        const entKey = String(er.key)
        const entVal = entityMap[entKey]
        if (!entVal) continue

        const entData = entVal.data || {}
        const caption = entData.caption || ''
        const items = entData.mediaItems || []

        for (const item of items) {
          const mid = String(item.mediaId || '')
          const imgUrl = mediaLookup[mid]
          if (imgUrl) {
            lines.push(`\n![${caption || 'image'}](${imgUrl})\n`)
          }
        }
      }
      continue
    }

    const styled = applyInlineStyles(text, ranges)

    switch (btype) {
      case 'header-one':
        lines.push(`# ${styled}`)
        break
      case 'header-two':
        lines.push(`\n## ${styled}`)
        break
      case 'header-three':
        lines.push(`\n### ${styled}`)
        break
      case 'unordered-list-item':
        lines.push(`- ${styled}`)
        break
      case 'ordered-list-item':
        lines.push(`1. ${styled}`)
        break
      case 'blockquote':
        lines.push(`> ${styled}`)
        break
      case 'code-block':
        lines.push(`\`\`\`\n${text}\n\`\`\``)
        break
      default:
        lines.push(styled || '')
    }
  }

  return lines.join('\n')
}

// Custom error classes for domain blocking
class DomainBlockedError extends Error {
  constructor(domain: string) {
    super(`Claude Code is unable to fetch from ${domain}`)
    this.name = 'DomainBlockedError'
  }
}

class DomainCheckFailedError extends Error {
  constructor(domain: string) {
    super(
      `Unable to verify if domain ${domain} is safe to fetch. This may be due to network restrictions or enterprise security policies blocking claude.ai.`,
    )
    this.name = 'DomainCheckFailedError'
  }
}

class EgressBlockedError extends Error {
  constructor(public readonly domain: string) {
    super(
      JSON.stringify({
        error_type: 'EGRESS_BLOCKED',
        domain,
        message: `Access to ${domain} is blocked by the network egress proxy.`,
      }),
    )
    this.name = 'EgressBlockedError'
  }
}

// Cache for storing fetched URL content
type CacheEntry = {
  bytes: number
  code: number
  codeText: string
  content: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}

// Cache with 15-minute TTL and 50MB size limit
// LRUCache handles automatic expiration and eviction
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

const URL_CACHE = new LRUCache<string, CacheEntry>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
})

// Separate cache for preflight domain checks. URL_CACHE is URL-keyed, so
// fetching two paths on the same domain triggers two identical preflight
// HTTP round-trips to api.anthropic.com. This hostname-keyed cache avoids
// that. Only 'allowed' is cached — blocked/failed re-check on next attempt.
const DOMAIN_CHECK_CACHE = new LRUCache<string, true>({
  max: 128,
  ttl: 5 * 60 * 1000, // 5 minutes — shorter than URL_CACHE TTL
})

export function clearWebFetchCache(): void {
  URL_CACHE.clear()
  DOMAIN_CHECK_CACHE.clear()
}

// Lazy singleton — defers the turndown → @mixmark-io/domino import (~1.4MB
// retained heap) until the first HTML fetch, and reuses one instance across
// calls (construction builds 15 rule objects; .turndown() is stateless).
// @types/turndown ships only `export =` (no .d.mts), so TS types the import
// as the class itself while Bun wraps CJS in { default } — hence the cast.
type TurndownCtor = typeof import('turndown')
let turndownServicePromise: Promise<InstanceType<TurndownCtor>> | undefined
function getTurndownService(): Promise<InstanceType<TurndownCtor>> {
  return (turndownServicePromise ??= import('turndown').then(m => {
    const Turndown = (m as unknown as { default: TurndownCtor }).default
    return new Turndown()
  }))
}

// PSR requested limiting the length of URLs to 250 to lower the potential
// for a data exfiltration. However, this is too restrictive for some customers'
// legitimate use cases, such as JWT-signed URLs (e.g., cloud service signed URLs)
// that can be much longer. We already require user approval for each domain,
// which provides a primary security boundary. In addition, Claude Code has
// other data exfil channels, and this one does not seem relatively high risk,
// so I'm removing that length restriction. -ab
const MAX_URL_LENGTH = 2000

// Per PSR:
// "Implement resource consumption controls because setting limits on CPU,
// memory, and network usage for the Web Fetch tool can prevent a single
// request or user from overwhelming the system."
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024

// Timeout for the main HTTP fetch request (60 seconds).
// Prevents hanging indefinitely on slow/unresponsive servers.
const FETCH_TIMEOUT_MS = 60_000

// Timeout for the domain blocklist preflight check (10 seconds).
const DOMAIN_CHECK_TIMEOUT_MS = 10_000

// Cap same-host redirect hops. Without this a malicious server can return
// a redirect loop (/a → /b → /a …) and the per-request FETCH_TIMEOUT_MS
// resets on every hop, hanging the tool until user interrupt. 10 matches
// common client defaults (axios=5, follow-redirects=21, Chrome=20).
const MAX_REDIRECTS = 10

// Truncate to not spend too many tokens
export const MAX_MARKDOWN_LENGTH = 100_000

export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)
  } catch {
    return false
  }
}

export function validateURL(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) {
    return false
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // We don't need to check protocol here, as we'll upgrade http to https when making the request

  // As long as we aren't supporting aiming to cookies or internal domains,
  // we should block URLs with usernames/passwords too, even though these
  // seem exceedingly unlikely.
  if (parsed.username || parsed.password) {
    return false
  }

  // Initial filter that this isn't a privileged, company-internal URL
  // by checking that the hostname is publicly resolvable
  const hostname = parsed.hostname
  const parts = hostname.split('.')
  if (parts.length < 2) {
    return false
  }

  return true
}

type DomainCheckResult =
  | { status: 'allowed' }
  | { status: 'blocked' }
  | { status: 'check_failed'; error: Error }

export async function checkDomainBlocklist(
  domain: string,
): Promise<DomainCheckResult> {
  if (DOMAIN_CHECK_CACHE.has(domain)) {
    return { status: 'allowed' }
  }
  try {
    const response = await axios.get(
      `https://api.anthropic.com/api/web/domain_info?domain=${encodeURIComponent(domain)}`,
      { timeout: DOMAIN_CHECK_TIMEOUT_MS },
    )
    if (response.status === 200) {
      if (response.data.can_fetch === true) {
        DOMAIN_CHECK_CACHE.set(domain, true)
        return { status: 'allowed' }
      }
      return { status: 'blocked' }
    }
    // Non-200 status but didn't throw
    return {
      status: 'check_failed',
      error: new Error(`Domain check returned status ${response.status}`),
    }
  } catch (e) {
    logError(e)
    return { status: 'check_failed', error: e as Error }
  }
}

/**
 * Check if a redirect is safe to follow
 * Allows redirects that:
 * - Add or remove "www." in the hostname
 * - Keep the origin the same but change path/query params
 * - Or both of the above
 */
export function isPermittedRedirect(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const parsedOriginal = new URL(originalUrl)
    const parsedRedirect = new URL(redirectUrl)

    if (parsedRedirect.protocol !== parsedOriginal.protocol) {
      return false
    }

    if (parsedRedirect.port !== parsedOriginal.port) {
      return false
    }

    if (parsedRedirect.username || parsedRedirect.password) {
      return false
    }

    // Now check hostname conditions
    // 1. Adding www. is allowed: example.com -> www.example.com
    // 2. Removing www. is allowed: www.example.com -> example.com
    // 3. Same host (with or without www.) is allowed: paths can change
    const stripWww = (hostname: string) => hostname.replace(/^www\./, '')
    const originalHostWithoutWww = stripWww(parsedOriginal.hostname)
    const redirectHostWithoutWww = stripWww(parsedRedirect.hostname)
    return originalHostWithoutWww === redirectHostWithoutWww
  } catch (_error) {
    return false
  }
}

/**
 * Helper function to handle fetching URLs with custom redirect handling
 * Recursively follows redirects if they pass the redirectChecker function
 *
 * Per PSR:
 * "Do not automatically follow redirects because following redirects could
 * allow for an attacker to exploit an open redirect vulnerability in a
 * trusted domain to force a user to make a request to a malicious domain
 * unknowingly"
 */
type RedirectInfo = {
  type: 'redirect'
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export async function getWithPermittedRedirects(
  url: string,
  signal: AbortSignal,
  redirectChecker: (originalUrl: string, redirectUrl: string) => boolean,
  depth = 0,
): Promise<AxiosResponse<ArrayBuffer> | RedirectInfo> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`)
  }
  try {
    return await axios.get(url, {
      signal,
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      responseType: 'arraybuffer',
      maxContentLength: MAX_HTTP_CONTENT_LENGTH,
      headers: {
        Accept: 'text/markdown, text/html, */*',
        'User-Agent': getWebFetchUserAgent(),
      },
    })
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      [301, 302, 307, 308].includes(error.response.status)
    ) {
      const redirectLocation = error.response.headers.location
      if (!redirectLocation) {
        throw new Error('Redirect missing Location header')
      }

      // Resolve relative URLs against the original URL
      const redirectUrl = new URL(redirectLocation, url).toString()

      if (redirectChecker(url, redirectUrl)) {
        // Recursively follow the permitted redirect
        return getWithPermittedRedirects(
          redirectUrl,
          signal,
          redirectChecker,
          depth + 1,
        )
      } else {
        // Return redirect information to the caller
        return {
          type: 'redirect',
          originalUrl: url,
          redirectUrl,
          statusCode: error.response.status,
        }
      }
    }

    // Detect egress proxy blocks: the proxy returns 403 with
    // X-Proxy-Error: blocked-by-allowlist when egress is restricted
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 403 &&
      error.response.headers['x-proxy-error'] === 'blocked-by-allowlist'
    ) {
      const hostname = new URL(url).hostname
      throw new EgressBlockedError(hostname)
    }

    throw error
  }
}

function isRedirectInfo(
  response: AxiosResponse<ArrayBuffer> | RedirectInfo,
): response is RedirectInfo {
  return 'type' in response && response.type === 'redirect'
}

export type FetchedContent = {
  content: string
  bytes: number
  code: number
  codeText: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}

// ============================================================================
// Multi-source Fetch Chain (from fetch-skill)
// Jina Reader -> defuddle.md -> markdown.new -> raw HTML
// ============================================================================

interface FetchStrategy {
  name: string
  url: string
  headers?: Record<string, string>
}

async function httpGetText(url: string, headers?: Record<string, string>, timeout = 30_000): Promise<string> {
  const response = await axios.get(url, {
    timeout,
    responseType: 'text',
    headers: headers ?? { 'User-Agent': getWebFetchUserAgent() },
  })
  return response.data as string
}

export async function fetchWithFallbackChain(
  url: string,
  signal: AbortSignal,
  skipJina = false,
): Promise<{ content: string; source: string; code: number }> {
  const strategies: FetchStrategy[] = []

  if (!skipJina) {
    strategies.push({
      name: 'Jina Reader',
      url: `${JINA_READER_URL}/${url}`,
      headers: { Accept: 'text/markdown' },
    })
  }

  strategies.push(
    { name: 'defuddle.md', url: `${DEFUDDLE_URL}/${url}` },
    { name: 'markdown.new', url: `${MARKDOWN_NEW_URL}/${url}` },
    { name: 'Raw HTML', url },
  )

  const errors: string[] = []

  for (const strategy of strategies) {
    try {
      const content = await httpGetText(strategy.url, strategy.headers, FETCH_TIMEOUT_MS)
      if (signal.aborted) throw new AbortError()
      return { content, source: strategy.name, code: 200 }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${strategy.name}: ${msg}`)
    }
  }

  throw new Error(`All fetch strategies failed:\n  ${errors.join('\n  ')}`)
}

// ============================================================================
// Twitter/X Fetcher (from fetch-skill)
// FxTwitter API (zero-dep) for single tweets
// ============================================================================

interface TweetAuthor {
  name: string
  screen_name: string
}

interface TweetMedia {
  photos?: { url: string }[]
  videos?: { url?: string; thumbnail_url?: string }[]
}

interface TweetQuote {
  author?: TweetAuthor
  text?: string
}

interface Tweet {
  text?: string
  author?: TweetAuthor
  created_at?: string
  likes?: number
  views?: number
  retweets?: number
  bookmarks?: number
  media?: TweetMedia
  quote?: TweetQuote
  article?: XArticle
}

interface FxTwitterResponse {
  tweet?: Tweet
}

function formatTweetAsText(tweet: Tweet): string {
  const author = tweet.author?.name || ''
  const handle = tweet.author?.screen_name || ''
  const body = tweet.text || ''
  const likes = tweet.likes || 0
  const views = tweet.views || 0
  const rts = tweet.retweets || 0
  const bmarks = tweet.bookmarks || 0
  const created = tweet.created_at || ''

  const lines: string[] = [
    `**${author}** (@${handle})  ${created}`,
    '',
    body,
    '',
    `❤️ ${likes}  👁 ${views}  🔁 ${rts}  🔖 ${bmarks}`,
  ]

  const media = tweet.media
  if (media) {
    const items = [...(media.photos || []), ...(media.videos || [])]
    for (const item of items) {
      const src = item.url || (item as { thumbnail_url?: string }).thumbnail_url
      if (src) {
        lines.push(`\n![](${src})`)
      }
    }
  }

  if (tweet.quote) {
    const qAuthor = tweet.quote.author?.name || ''
    const qText = tweet.quote.text || ''
    lines.push('', '---', 'Quoted:', '', `> **${qAuthor}**: ${qText}`)
  }

  return lines.join('\n')
}

function formatTweetAsJson(data: FxTwitterResponse, pretty = false): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined)
}

export async function fetchTwitterContent(
  url: string,
  signal: AbortSignal,
  options: {
    format?: OutputFormat
    pretty?: boolean
    textOnly?: boolean
  } = {},
): Promise<{ content: string; source: string; code: number }> {
  const { format = 'markdown', pretty = false, textOnly = false } = options

  // Check for X Article
  const articleId = extractArticleId(url)
  if (articleId) {
    // X Articles require Camofox (not implemented in pure TypeScript version)
    // Fall back to web fetch
    const result = await fetchWithFallbackChain(url, signal)
    return { ...result, source: `Article (fallback: ${result.source})` }
  }

  // Single tweet via FxTwitter
  const tweetId = extractTweetId(url)
  if (!tweetId) {
    // Not a specific tweet URL, use web fallback
    const result = await fetchWithFallbackChain(url, signal)
    return { ...result, source: `Twitter (fallback: ${result.source})` }
  }

  // Extract username from URL
  const userMatch = url.match(/\.com\/([^/]+)\/status\//i)
  const username = userMatch ? userMatch[1] : '_'

  // Try FxTwitter API paths
  const apiPaths = [`/${username}/status/${tweetId}`, `/status/${tweetId}`]

  for (const apiPath of apiPaths) {
    try {
      const apiUrl = `${FXTWITTER_API}${apiPath}`
      const data = await httpGetText(apiUrl, undefined, FETCH_TIMEOUT_MS) as unknown as FxTwitterResponse

      if (signal.aborted) throw new AbortError()

      const tweet = (data as FxTwitterResponse).tweet
      if (!tweet) continue

      // Check for X Article
      if (tweet.article) {
        const md = parseDraftJSToMarkdown(tweet.article)
        if (textOnly || format === 'text') {
          const author = tweet.author?.name || ''
          const handle = tweet.author?.screen_name || ''
          const created = tweet.created_at || ''
          const likes = tweet.likes || 0
          const views = tweet.views || 0
          const rts = tweet.retweets || 0
          const bmarks = tweet.bookmarks || 0
          const header = `> **${author}** (@${handle})  ${created}\n> ❤️ ${likes}  👁 ${views}  🔁 ${rts}  🔖 ${bmarks}\n\n---\n\n`
          return { content: header + md, source: 'FxTwitter (Article)', code: 200 }
        }
        return { content: md, source: 'FxTwitter (Article)', code: 200 }
      }

      // Regular tweet
      if (textOnly || format === 'text') {
        return { content: formatTweetAsText(tweet), source: 'FxTwitter', code: 200 }
      }

      if (format === 'json') {
        return { content: formatTweetAsJson(data as FxTwitterResponse, pretty), source: 'FxTwitter', code: 200 }
      }

      // Default markdown format
      return { content: formatTweetAsText(tweet), source: 'FxTwitter', code: 200 }
    } catch (err) {
      // 404 means try next path, other errors throw
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        continue
      }
      throw err
    }
  }

  // All FxTwitter paths failed, fall back to web
  const result = await fetchWithFallbackChain(url, signal)
  return { ...result, source: `Twitter (fallback: ${result.source})` }
}

// ============================================================================
// WeChat Article Fetcher (from fetch-skill)
// WeSpy -> wechat-article-exporter -> Jina -> defuddle -> Raw
// ============================================================================

function unwrapWechatCaptchaUrl(url: string): string {
  // Extract real URL from WeChat captcha redirect page
  // wappoc_appmsgcaptcha?poc_token=...&target_url=<real_url>
  try {
    const parsed = new URL(url)
    if (parsed.pathname.includes('wappoc_appmsgcaptcha')) {
      const target = parsed.searchParams.get('target_url')
      if (target) return target
    }
  } catch {
    // Not a valid URL, return as-is
  }
  return url
}

async function fetchWechatViaExporter(url: string, apiBase: string, timeout: number): Promise<string | null> {
  try {
    const endpoint = `${apiBase.replace(/\/$/, '')}/api/article?url=${encodeURIComponent(url)}`
    const data = await httpGetText(endpoint, undefined, timeout) as unknown as {
      markdown?: string
      content?: string
      html?: string
    }
    return data.markdown || data.content || data.html || null
  } catch {
    return null
  }
}

export async function fetchWechatContent(
  url: string,
  signal: AbortSignal,
  options: {
    wechatApiUrl?: string
  } = {},
): Promise<{ content: string; source: string; code: number }> {
  const { wechatApiUrl } = options

  // Unwrap captcha URL if needed
  const unwrappedUrl = unwrapWechatCaptchaUrl(url)
  const targetUrl = unwrappedUrl !== url ? unwrappedUrl : url

  // Try wechat-article-exporter API if configured
  if (wechatApiUrl) {
    try {
      const content = await fetchWechatViaExporter(targetUrl, wechatApiUrl, FETCH_TIMEOUT_MS)
      if (content) {
        if (signal.aborted) throw new AbortError()
        return { content, source: 'wechat-article-exporter', code: 200 }
      }
    } catch (err) {
      // Fall through to next strategy
    }
  }

  // Fall back to generic web fetch chain
  const result = await fetchWithFallbackChain(targetUrl, signal)
  return { ...result, source: `WeChat (fallback: ${result.source})` }
}

// ============================================================================
// Unified Fetch Dispatcher (from fetch-skill)
// ============================================================================

export interface FetchOptions {
  mode?: FetchMode
  format?: OutputFormat
  skipJina?: boolean
  pretty?: boolean
  textOnly?: boolean
  wechatApiUrl?: string
}

export async function fetchContent(
  url: string,
  signal: AbortSignal,
  options: FetchOptions = {},
): Promise<{ content: string; source: string; code: number; bytes: number }> {
  const mode = options.mode === 'auto' || !options.mode
    ? detectFetchMode(url)
    : options.mode

  let result: { content: string; source: string; code: number }

  switch (mode) {
    case 'twitter':
      result = await fetchTwitterContent(url, signal, {
        format: options.format,
        pretty: options.pretty,
        textOnly: options.textOnly,
      })
      break
    case 'wechat':
      result = await fetchWechatContent(url, signal, {
        wechatApiUrl: options.wechatApiUrl,
      })
      break
    case 'web':
    default:
      result = await fetchWithFallbackChain(url, signal, options.skipJina)
      break
  }

  const bytes = Buffer.byteLength(result.content)
  return { ...result, bytes }
}

// ============================================================================
// CDP Integration - Direct Chrome DevTools Protocol via scripts/cdp.mjs
// For JavaScript-rendered pages and anti-bot protected sites
// ============================================================================

// Find the CDP script path (shared with ChromeCDPTool)
function findCDPScriptPath(): string | null {
  // Try multiple possible paths in order of likelihood
  const possiblePaths = [
    // Project root scripts directory (development/bundled mode)
    resolve(process.cwd(), 'scripts/cdp.mjs'),
    // Relative to this file's location
    resolve(__dirname, '../../../scripts/cdp.mjs'),
    // Absolute project path
    resolve(homedir(), 'yyscode/opencc/scripts/cdp.mjs'),
    // Skill directory (user-installed skill)
    resolve(getClaudeConfigHomeDir(), 'skills/chrome-cdp/scripts/cdp.mjs'),
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}

const CDP_SCRIPT_PATH = findCDPScriptPath()

interface CDPResult {
  success: boolean
  output: string
  error?: string
}

async function runCDPCommand(
  command: string,
  target?: string,
  args?: string[],
): Promise<CDPResult> {
  if (!CDP_SCRIPT_PATH) {
    return { success: false, output: '', error: 'CDP script not found' }
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

export async function isCDPAvailable(): Promise<boolean> {
  if (!CDP_SCRIPT_PATH) {
    console.error('[WebFetch] CDP script not found. Searched paths:', [
      resolve(process.cwd(), 'scripts/cdp.mjs'),
      resolve(__dirname, '../../../scripts/cdp.mjs'),
      resolve(homedir(), 'yyscode/opencc/scripts/cdp.mjs'),
    ])
    return false
  }

  const result = await runCDPCommand('list')
  return result.success && result.output.includes('http')
}

async function extractContentViaCDP(targetId: string): Promise<string> {
  // Use eval to extract page content with Readability-like logic
  // Note: cdp.mjs 'eval' command takes the JS expression as first arg
  const extractionScript = `(() => {
    const selectors = [
      'article',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '.note-content',
      'main',
      '#content',
      '#main-content',
      '.search-result-list',
      '.feeds-page',
      '.explore-feed',
      '.search-Result',
      '.note-item'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.length > 200) return el.innerText;
    }
    // Fallback: clean body text
    const body = document.body;
    if (!body) return '';
    const clone = body.cloneNode(true);
    const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe'];
    for (const tag of removeTags) {
      const elements = clone.querySelectorAll(tag);
      elements.forEach(e => e.remove());
    }
    return clone.innerText || document.title || '';
  })()`

  const result = await runCDPCommand('eval', targetId, [extractionScript])
  if (!result.success) {
    throw new Error(`CDP eval failed: ${result.error}`)
  }
  return result.output
}

export async function fetchViaCDP(
  url: string,
  signal: AbortSignal,
  options: {
    waitForSelector?: string
    extractContent?: boolean
    scrollToBottom?: boolean
  } = {},
): Promise<{ content: string; source: string; code: number; bytes: number }> {
  const { waitForSelector, extractContent = true, scrollToBottom = false } = options

  // Check if CDP is available
  if (!CDP_SCRIPT_PATH) {
    const searchedPaths = [
      resolve(process.cwd(), 'scripts/cdp.mjs'),
      resolve(__dirname, '../../../scripts/cdp.mjs'),
      resolve(homedir(), 'yyscode/opencc/scripts/cdp.mjs'),
      resolve(getClaudeConfigHomeDir(), 'skills/chrome-cdp/scripts/cdp.mjs'),
    ]
    throw new Error(
      'CDP script not found. Searched paths:\n' +
      searchedPaths.map(p => '  - ' + p).join('\n') +
      '\n\nTo fetch JavaScript-rendered pages:\n' +
      '1. Ensure the chrome-cdp skill is installed\n' +
      '2. Or use WebSearch tool to find alternative sources',
    )
  }

  // Test if CDP is actually working
  const listResult = await runCDPCommand('list')
  if (!listResult.success) {
    throw new Error(
      `CDP not available: ${listResult.error}\n` +
      'Please ensure Chrome is running with --remote-debugging-port=9222',
    )
  }

  // Navigate to URL in Chrome
  // First, find an existing page or use the first one
  const pages = listResult.output.split('\n').filter(line => line.includes('http'))
  if (pages.length === 0) {
    throw new Error('No Chrome pages available')
  }

  // Extract target ID from the first page
  const firstPage = pages[0]!
  const targetMatch = firstPage.match(/^\s*(\S+)/)
  const targetId = targetMatch ? targetMatch[1] : null

  if (!targetId) {
    throw new Error('Could not find valid Chrome target')
  }

  try {
    // Navigate to the URL
    const navResult = await runCDPCommand('nav', targetId, [url])
    if (!navResult.success) {
      throw new Error(`Navigation failed: ${navResult.error}`)
    }

    // Wait for initial render
    await new Promise(r => setTimeout(r, 3000))

    if (signal.aborted) {
      throw new AbortError()
    }

    // Scroll to bottom if requested (triggers lazy loading)
    if (scrollToBottom) {
      await runCDPCommand('eval', targetId, [
        'window.scrollTo(0, document.body.scrollHeight)',
      ]).catch(() => { /* ignore scroll errors */ })
      await new Promise(r => setTimeout(r, 2000))
    }

    if (signal.aborted) {
      throw new AbortError()
    }

    // Wait for specific selector if provided
    if (waitForSelector) {
      const checkInterval = 500
      const maxWait = 10000
      const startTime = Date.now()

      while (Date.now() - startTime < maxWait) {
        const checkResult = await runCDPCommand('eval', targetId, [
          `!!document.querySelector(${JSON.stringify(waitForSelector)})`,
        ])
        if (checkResult.success && checkResult.output.includes('true')) break
        await new Promise(r => setTimeout(r, checkInterval))
      }
    }

    if (signal.aborted) {
      throw new AbortError()
    }

    // Extract content
    let content: string
    let source = 'CDP'

    if (extractContent) {
      content = await extractContentViaCDP(targetId)
    } else {
      // Get raw HTML
      const htmlResult = await runCDPCommand('eval', targetId, [
        'document.documentElement.outerHTML',
      ])
      if (!htmlResult.success) {
        throw new Error(`Failed to get HTML: ${htmlResult.error}`)
      }
      content = htmlResult.output
    }

    // Get page title
    const titleResult = await runCDPCommand('eval', targetId, ['document.title'])
    const title = titleResult.success ? titleResult.output : ''

    // Format as markdown
    const result = title
      ? `# ${title}\n\n${content}`
      : content

    const bytes = Buffer.byteLength(result)
    return { content: result, source, code: 200, bytes }
  } catch (err) {
    if (err instanceof AbortError) throw err
    throw new Error(`CDP fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function getURLMarkdownContent(
  url: string,
  abortController: AbortController,
): Promise<FetchedContent | RedirectInfo> {
  if (!validateURL(url)) {
    throw new Error('Invalid URL')
  }

  // Check cache (LRUCache handles TTL automatically)
  const cachedEntry = URL_CACHE.get(url)
  if (cachedEntry) {
    return {
      bytes: cachedEntry.bytes,
      code: cachedEntry.code,
      codeText: cachedEntry.codeText,
      content: cachedEntry.content,
      contentType: cachedEntry.contentType,
      persistedPath: cachedEntry.persistedPath,
      persistedSize: cachedEntry.persistedSize,
    }
  }

  let parsedUrl: URL
  let upgradedUrl = url

  try {
    parsedUrl = new URL(url)

    // Upgrade http to https if needed
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:'
      upgradedUrl = parsedUrl.toString()
    }

    const hostname = parsedUrl.hostname

    // Check if the user has opted to skip the blocklist check
    // This is for enterprise customers with restrictive security policies
    // that prevent outbound connections to claude.ai
    const settings = getSettings_DEPRECATED()
    if (!settings.skipWebFetchPreflight) {
      const checkResult = await checkDomainBlocklist(hostname)
      switch (checkResult.status) {
        case 'allowed':
          // Continue with the fetch
          break
        case 'blocked':
          throw new DomainBlockedError(hostname)
        case 'check_failed':
          throw new DomainCheckFailedError(hostname)
      }
    }

    if (process.env.USER_TYPE === 'ant') {
      logEvent('tengu_web_fetch_host', {
        hostname:
          hostname as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch (e) {
    if (
      e instanceof DomainBlockedError ||
      e instanceof DomainCheckFailedError
    ) {
      // Expected user-facing failures - re-throw without logging as internal error
      throw e
    }
    logError(e)
  }

  const response = await getWithPermittedRedirects(
    upgradedUrl,
    abortController.signal,
    isPermittedRedirect,
  )

  // Check if we got a redirect response
  if (isRedirectInfo(response)) {
    return response
  }

  const rawBuffer = Buffer.from(response.data)
  // Release the axios-held ArrayBuffer copy; rawBuffer owns the bytes now.
  // This lets GC reclaim up to MAX_HTTP_CONTENT_LENGTH (10MB) before Turndown
  // builds its DOM tree (which can be 3-5x the HTML size).
  ;(response as { data: unknown }).data = null
  const contentType = response.headers['content-type'] ?? ''

  // Binary content: save raw bytes to disk with a proper extension so Claude
  // can inspect the file later. We still fall through to the utf-8 decode +
  // Haiku path below — for PDFs in particular the decoded string has enough
  // ASCII structure (/Title, text streams) that Haiku can summarize it, and
  // the saved file is a supplement rather than a replacement.
  let persistedPath: string | undefined
  let persistedSize: number | undefined
  if (isBinaryContentType(contentType)) {
    const persistId = `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await persistBinaryContent(rawBuffer, contentType, persistId)
    if (!('error' in result)) {
      persistedPath = result.filepath
      persistedSize = result.size
    }
  }

  const bytes = rawBuffer.length
  const htmlContent = rawBuffer.toString('utf-8')

  let markdownContent: string
  let contentBytes: number
  if (contentType.includes('text/html')) {
    markdownContent = (await getTurndownService()).turndown(htmlContent)
    contentBytes = Buffer.byteLength(markdownContent)
  } else {
    // It's not HTML - just use it raw. The decoded string's UTF-8 byte
    // length equals rawBuffer.length (modulo U+FFFD replacement on invalid
    // bytes — negligible for cache eviction accounting), so skip the O(n)
    // Buffer.byteLength scan.
    markdownContent = htmlContent
    contentBytes = bytes
  }

  // Store the fetched content in cache. Note that it's stored under
  // the original URL, not the upgraded or redirected URL.
  const entry: CacheEntry = {
    bytes,
    code: response.status,
    codeText: response.statusText,
    content: markdownContent,
    contentType,
    persistedPath,
    persistedSize,
  }
  // lru-cache requires positive integers; clamp to 1 for empty responses.
  URL_CACHE.set(url, entry, { size: Math.max(1, contentBytes) })
  return entry
}

export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
  isPreapprovedDomain: boolean,
): Promise<string> {
  // Truncate content to avoid "Prompt is too long" errors from the secondary model
  const truncatedContent =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? markdownContent.slice(0, MAX_MARKDOWN_LENGTH) +
        '\n\n[Content truncated due to length...]'
      : markdownContent

  const modelPrompt = makeSecondaryModelPrompt(
    truncatedContent,
    prompt,
    isPreapprovedDomain,
  )
  const assistantMessage = await queryHaiku({
    systemPrompt: asSystemPrompt([]),
    userPrompt: modelPrompt,
    signal,
    options: {
      querySource: 'web_fetch_apply',
      agents: [],
      isNonInteractiveSession,
      hasAppendSystemPrompt: false,
      mcpTools: [],
    },
  })

  // We need to bubble this up, so that the tool call throws, causing us to return
  // an is_error tool_use block to the server, and render a red dot in the UI.
  if (signal.aborted) {
    throw new AbortError()
  }

  const { content } = assistantMessage.message
  if (content.length > 0) {
    const contentBlock = content[0]
    if (contentBlock && typeof contentBlock === 'object' && 'text' in contentBlock) {
      return (contentBlock as { text: string }).text
    }
  }
  return 'No response from model'
}
