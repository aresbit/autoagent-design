import type { HrTime } from '@opentelemetry/api'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs'

// First-party event logging is disabled in the OSS build.
// This module provides stub implementations that do nothing.

type FirstPartyEventLoggingEvent = {
  event_type: 'ClaudeCodeInternalEvent' | 'GrowthbookExperimentEvent'
  event_data: unknown
}

/**
 * Exporter for 1st-party event logging.
 *
 * DISABLED IN OSS BUILD - all export operations are no-ops.
 */
export class FirstPartyEventLoggingExporter implements LogRecordExporter {
  constructor(_options?: unknown) {
    // No-op in OSS build
  }

  async export(
    _logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    // Immediately report success without sending anything
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  async forceFlush(): Promise<void> {
    // No-op
  }
}

/**
 * Transform logs to 1P events format.
 * Disabled in OSS build - returns empty array.
 */
export function transformLogsToEvents(
  _logs: unknown,
): { events: FirstPartyEventLoggingEvent[] } {
  return { events: [] }
}

// Helper type for HrTime conversion (unused in OSS build)
export function hrTimeToDate(_hrTime: HrTime): Date {
  return new Date()
}
