import {
  armHandoffQuickResume,
  formatHandoffTimestamp,
  getLatestHandoff,
  isRecentHandoff,
} from 'src/utils/handoffResume.js'
import { useStartupNotification } from './useStartupNotification.js'

export function useHandoffResumeNotification() {
  useStartupNotification(findHandoffNotification)
}

async function findHandoffNotification() {
  const latest = await getLatestHandoff()
  if (!latest) return null
  if (!isRecentHandoff(latest)) return null

  armHandoffQuickResume()
  const when = formatHandoffTimestamp(latest.modifiedAt)
  return {
    key: 'handoff-resume-suggestion',
    text: `Found recent handoff: ${latest.relativePath} (${when}) · Type "y" to resume now, or run: /resume-handoff ${latest.relativePath}`,
    priority: 'medium' as const,
    color: 'warning' as const,
    timeoutMs: 14000,
  }
}
