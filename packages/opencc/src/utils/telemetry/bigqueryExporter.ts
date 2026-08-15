import type { Attributes, HrTime } from '@opentelemetry/api'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import {
  AggregationTemporality,
  type MetricData,
  type DataPoint as OTelDataPoint,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'

/**
 * BigQuery metrics exporter is disabled in the OSS build.
 */

type DataPoint = {
  attributes: Record<string, string>
  value: number
  timestamp: string
}

type Metric = {
  name: string
  description?: string
  unit?: string
  data_points: DataPoint[]
}

type InternalMetricsPayload = {
  resource_attributes: Record<string, string>
  metrics: Metric[]
}

/**
 * BigQuery metrics exporter for 1P metrics ingestion.
 * DISABLED IN OSS BUILD - all export operations are no-ops.
 */
export class BigQueryMetricsExporter implements PushMetricExporter {
  constructor(_options?: { timeout?: number }) {
    // No-op in OSS build
  }

  async export(
    _metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    // Immediately report success without sending anything
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async forceFlush(): Promise<void> {
    // No-op
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  selectAggregationTemporality(
    _instrumentType: unknown,
  ): AggregationTemporality {
    return AggregationTemporality.DELTA
  }
}
