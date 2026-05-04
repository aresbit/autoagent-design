export const WEB_FETCH_TOOL_NAME = 'WebFetch'

export const DESCRIPTION = `
- Fetches content from a specified URL and processes it using an AI model
- Supports multiple content sources with automatic fallback for maximum success rate
- Has special handling for Twitter/X and WeChat articles
- Supports Chrome DevTools Protocol (CDP) for JavaScript-rendered pages and anti-bot protected sites
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

URL Type Support:
  - General webpages: Uses Jina Reader → defuddle.md → markdown.new → Raw HTML fallback chain
  - Twitter/X URLs: Uses FxTwitter API for single tweets (zero dependency, no API key needed)
  - WeChat articles: Supports wechat-article-exporter API with automatic fallback
  - X Articles: Parsed from DraftJS format when available
  - Anti-bot sites (小红书, 微博, etc.): Set useCDP=true or tool will auto-detect and use CDP mode

CDP Mode (JavaScript-rendered pages):
  - For sites that require JavaScript to load content (Xiaohongshu, SPA apps)
  - For sites with anti-bot protection that block static fetchers
  - Requires Chrome running with --remote-debugging-port=9222
  - Tool auto-detects when content is insufficient and tries CDP fallback

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
`

export function makeSecondaryModelPrompt(
  markdownContent: string,
  prompt: string,
  isPreapprovedDomain: boolean,
): string {
  const guidelines = isPreapprovedDomain
    ? `Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.`
    : `Provide a concise response based only on the content above. In your response:
 - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.
 - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.
 - You are not a lawyer and never comment on the legality of your own prompts and responses.
 - Never produce or reproduce exact song lyrics.`

  return `
Web page content:
---
${markdownContent}
---

${prompt}

${guidelines}
`
}
