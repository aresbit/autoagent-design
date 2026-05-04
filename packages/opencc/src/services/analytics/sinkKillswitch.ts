/**
 * Analytics sink killswitch
 *
 * DISABLED IN OSS BUILD - all sinks are permanently killed.
 */

export type SinkName = 'datadog' | 'firstParty'

/**
 * Check if an analytics sink is killed (disabled).
 * In OSS build, all sinks are always disabled.
 */
export function isSinkKilled(_sink: SinkName): boolean {
  return true
}
