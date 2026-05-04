/**
 * Shared event metadata enrichment for analytics systems
 *
 * DISABLED IN OSS BUILD - returns minimal empty data.
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

/**
 * Sanitizes tool names for analytics logging.
 * Disabled in OSS build.
 */
export function sanitizeToolNameForAnalytics(
  _toolName: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return 'mcp_tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if detailed tool name logging is enabled for OTLP events.
 * Disabled in OSS build.
 */
export function isToolDetailsLoggingEnabled(): boolean {
  return false
}

/**
 * Check if detailed tool name logging is enabled for analytics events.
 * Disabled in OSS build.
 */
export function isAnalyticsToolDetailsLoggingEnabled(
  _mcpServerType: string | undefined,
  _mcpServerBaseUrl: string | undefined,
): boolean {
  return false
}

/**
 * Spreadable helper for logEvent payloads.
 * Disabled in OSS build.
 */
export function mcpToolDetailsForAnalytics(
  _toolName: string,
  _mcpServerType: string | undefined,
  _mcpServerBaseUrl: string | undefined,
): {
  mcpServerName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  mcpToolName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  return {}
}

/**
 * Extract MCP server and tool names from a full MCP tool name.
 * Disabled in OSS build.
 */
export function extractMcpToolDetails(_toolName: string):
  | {
      serverName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      mcpToolName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    }
  | undefined {
  return undefined
}

/**
 * Extract skill name from Skill tool input.
 * Disabled in OSS build.
 */
export function extractSkillName(
  _toolName: string,
  _input: unknown,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}

/**
 * Serialize a tool's input arguments for the OTel tool_result event.
 * Disabled in OSS build - always returns undefined.
 */
export function extractToolInputForTelemetry(
  _input: unknown,
): string | undefined {
  return undefined
}

/**
 * Extracts and sanitizes a file extension for analytics logging.
 * Disabled in OSS build.
 */
export function getFileExtensionForAnalytics(
  _filePath: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}

/**
 * Extracts file extensions from a bash command for analytics.
 * Disabled in OSS build.
 */
export function getFileExtensionsFromBashCommand(
  _command: string,
  _simulatedSedEditFilePath?: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}

/**
 * Environment context metadata
 * Disabled in OSS build - returns empty minimal object.
 */
export type EnvContext = {
  platform: string
  platformRaw: string
  arch: string
  nodeVersion: string
  terminal: string | null
  packageManagers: string
  runtimes: string
  isRunningWithBun: boolean
  isCi: boolean
  isClaubbit: boolean
  isClaudeCodeRemote: boolean
  isLocalAgentMode: boolean
  isConductor: boolean
  version: string
  buildTime: string
  deploymentEnvironment: string
}

/**
 * Process metrics included with all analytics events.
 * Disabled in OSS build.
 */
export type ProcessMetrics = {
  uptime: number
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
  constrainedMemory: number | undefined
  cpuUsage: NodeJS.CpuUsage
  cpuPercent: number | undefined
}

/**
 * Core event metadata shared across all analytics systems
 * Disabled in OSS build.
 */
export type EventMetadata = {
  model: string
  sessionId: string
  userType: string
  envContext: EnvContext
  isInteractive: string
  clientType: string
  sweBenchRunId: string
  sweBenchInstanceId: string
  sweBenchTaskId: string
}

/**
 * Options for enriching event metadata
 */
export type EnrichMetadataOptions = {
  model?: unknown
  betas?: unknown
  additionalMetadata?: Record<string, unknown>
}

/**
 * Get core event metadata shared across all analytics systems.
 * Disabled in OSS build - returns minimal empty data.
 */
export async function getEventMetadata(
  _options: EnrichMetadataOptions = {},
): Promise<EventMetadata> {
  return {
    model: '',
    sessionId: '',
    userType: '',
    envContext: {
      platform: '',
      platformRaw: '',
      arch: '',
      nodeVersion: '',
      terminal: null,
      packageManagers: '',
      runtimes: '',
      isRunningWithBun: false,
      isCi: false,
      isClaubbit: false,
      isClaudeCodeRemote: false,
      isLocalAgentMode: false,
      isConductor: false,
      version: '',
      buildTime: '',
      deploymentEnvironment: '',
    },
    isInteractive: 'false',
    clientType: '',
    sweBenchRunId: '',
    sweBenchInstanceId: '',
    sweBenchTaskId: '',
  }
}

/**
 * Core event metadata for 1P event logging (snake_case format).
 * Disabled in OSS build.
 */
export type FirstPartyEventLoggingCoreMetadata = {
  session_id: string
  model: string
  user_type: string
  is_interactive: boolean
  client_type: string
}

/**
 * Complete event logging metadata format for 1P events.
 * Disabled in OSS build.
 */
export type FirstPartyEventLoggingMetadata = {
  env: Record<string, unknown>
  process?: string
  auth?: Record<string, unknown>
  core: FirstPartyEventLoggingCoreMetadata
  additional: Record<string, unknown>
}

/**
 * Convert metadata to 1P event logging format (snake_case fields).
 * Disabled in OSS build - returns empty minimal data.
 */
export function to1PEventFormat(
  _metadata: EventMetadata,
  _userMetadata: unknown,
  _additionalMetadata: Record<string, unknown> = {},
): FirstPartyEventLoggingMetadata {
  return {
    env: {},
    core: {
      session_id: '',
      model: '',
      user_type: '',
      is_interactive: false,
      client_type: '',
    },
    additional: {},
  }
}
