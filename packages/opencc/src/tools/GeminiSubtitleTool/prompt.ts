export const GEMINI_SUBTITLE_TOOL_NAME = 'geminisubtitle'

export const DESCRIPTION = `
Use Chrome CDP to open Gemini Gem pages and request Chinese subtitles via your custom Gem (e.g., 字幕君).

This tool automates a browser tab through scripts/cdp.mjs:
- Selects a Chrome tab target
- Navigates to Gemini Gem URL
- Sends your request text
- Polls and returns the latest model response

Requirements:
- Chrome is running with remote debugging enabled
- You are already signed in to Gemini in Chrome
- scripts/cdp.mjs is available (repo or installed chrome-cdp skill)
`

export function getPrompt(): string {
  return DESCRIPTION
}
