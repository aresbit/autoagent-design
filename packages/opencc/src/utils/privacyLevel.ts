/**
 * Privacy level controls how much nonessential network traffic and telemetry
 * Claude Code generates.
 *
 * DISABLED IN OSS BUILD - all telemetry is permanently disabled.
 */

type PrivacyLevel = 'default' | 'no-telemetry' | 'essential-traffic'

/**
 * Get privacy level.
 * In OSS build, always returns 'essential-traffic' (most restrictive).
 */
export function getPrivacyLevel(): PrivacyLevel {
  return 'essential-traffic'
}

/**
 * True when all nonessential network traffic should be suppressed.
 * In OSS build, always returns true.
 */
export function isEssentialTrafficOnly(): boolean {
  return true
}

/**
 * True when telemetry/analytics should be suppressed.
 * In OSS build, always returns true.
 */
export function isTelemetryDisabled(): boolean {
  return true
}

/**
 * Returns the env var name responsible for the current essential-traffic restriction,
 * or null if unrestricted.
 * In OSS build, always returns 'OSS_BUILD' since telemetry is permanently disabled.
 */
export function getEssentialTrafficOnlyReason(): string | null {
  return 'OSS_BUILD'
}
