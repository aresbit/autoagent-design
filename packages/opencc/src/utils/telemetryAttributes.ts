import type { Attributes } from '@opentelemetry/api'

/**
 * Telemetry attributes are disabled in the OSS build.
 * Returns empty attributes to prevent any tracking.
 */

export function getTelemetryAttributes(): Attributes {
  // In OSS build, return empty attributes - no telemetry tracking
  return {}
}
