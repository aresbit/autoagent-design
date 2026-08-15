import { readFile, readdir, stat } from 'fs/promises'
import { isAbsolute, join, relative } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'

export type HandoffInfo = {
  absolutePath: string
  relativePath: string
  modifiedAt: Date
}

export const HANDOFF_SUBDIR = join('.claude', 'handoffs')
export const HANDOFF_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
const QUICK_RESUME_WINDOW_MS = 1000 * 60 * 10 // 10 minutes
const YES_RE = /^(y|yes)$/i

let quickResumeExpiresAt = 0

export async function getLatestHandoff(): Promise<HandoffInfo | null> {
  const projectRoot = getProjectRoot()
  const handoffDir = join(projectRoot, HANDOFF_SUBDIR)

  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(handoffDir, { withFileTypes: true })
  } catch {
    return null
  }

  const markdownFiles = entries.filter(
    entry =>
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.md') &&
      !entry.name.startsWith('.'),
  )
  if (markdownFiles.length === 0) return null

  const withStats = await Promise.all(
    markdownFiles.map(async entry => {
      const absolutePath = join(handoffDir, entry.name)
      try {
        const fileStat = await stat(absolutePath)
        return { absolutePath, modifiedAt: new Date(fileStat.mtimeMs) }
      } catch {
        return null
      }
    }),
  )

  const valid = withStats.filter(_ => _ !== null)
  if (valid.length === 0) return null

  const latest = valid.reduce((current, candidate) =>
    candidate.modifiedAt.getTime() > current.modifiedAt.getTime()
      ? candidate
      : current,
  )

  return {
    absolutePath: latest.absolutePath,
    relativePath: normalizeForPrompt(relative(projectRoot, latest.absolutePath)),
    modifiedAt: latest.modifiedAt,
  }
}

export function isRecentHandoff(handoff: HandoffInfo): boolean {
  return Date.now() - handoff.modifiedAt.getTime() <= HANDOFF_MAX_AGE_MS
}

export function armHandoffQuickResume(): void {
  quickResumeExpiresAt = Date.now() + QUICK_RESUME_WINDOW_MS
}

export function clearHandoffQuickResume(): void {
  quickResumeExpiresAt = 0
}

export function consumeHandoffQuickResumeIfYes(input: string): boolean {
  if (Date.now() > quickResumeExpiresAt) {
    quickResumeExpiresAt = 0
    return false
  }
  if (!YES_RE.test(input.trim())) return false
  quickResumeExpiresAt = 0
  return true
}

export function dismissHandoffQuickResumeOnUserInput(input: string): void {
  if (quickResumeExpiresAt === 0) return
  if (input.trim().length === 0) return
  quickResumeExpiresAt = 0
}

export async function resolveHandoffPath(
  rawArg: string | undefined,
): Promise<{ absolutePath: string; relativePath: string }> {
  const projectRoot = getProjectRoot()

  if (!rawArg || rawArg.trim().length === 0) {
    const latest = await getLatestHandoff()
    if (!latest) {
      throw new Error('No handoff files found in .claude/handoffs')
    }
    return {
      absolutePath: latest.absolutePath,
      relativePath: latest.relativePath,
    }
  }

  const trimmed = rawArg.trim()
  const absolutePath = isAbsolute(trimmed)
    ? trimmed
    : join(projectRoot, trimmed)
  return {
    absolutePath,
    relativePath: normalizeForPrompt(relative(projectRoot, absolutePath)),
  }
}

export async function readHandoffFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    logForDebugging(
      `Failed to read handoff file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

export function formatHandoffTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function pad2(v: number): string {
  return v.toString().padStart(2, '0')
}

function normalizeForPrompt(filePath: string): string {
  return filePath.split('\\').join('/')
}
