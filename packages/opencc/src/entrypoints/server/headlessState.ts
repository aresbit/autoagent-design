/**
 * Headless AppState factory for the server entrypoint.
 *
 * Creates a minimal AppState + CanUseTool without requiring the full CLI
 * bootstrap (no React/Ink, no Commander arg parsing, no trust dialogs).
 *
 * Reuses CLI's getTools() for tool discovery — avoids stub-related crashes
 * (e.g. "tools.map is not a function" from passing {} as Tools).
 */

import { randomUUID } from 'node:crypto';
import type { AppState } from '../../state/AppState.js';
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js';
import type { ToolPermissionContext } from '../../types/permissions.js';
import type { Tools } from '../../Tool.js';
import { getTools } from '../../tools.js';

interface HeadlessStateOptions {
  cwd: string;
  permissionMode: string;
  allowedTools: string[];
  model: string;
  apiKey: string;
  baseURL: string;
}

interface HeadlessStateResult {
  appState: AppState;
  setAppStateFn: (f: (prev: AppState) => AppState) => void;
}

/**
 * Create a minimal AppState suitable for headless/server use.
 *
 * Reuses CLI's getTools() so the tool registry matches exactly what the
 * interactive path would produce. Avoids the stub {} that causes
 * "tools.map is not a function" in getSystemPrompt().
 */
export function createAppState(opts: HeadlessStateOptions): HeadlessStateResult {
  // Build the tool permission context matching CLI defaults
  const permissionContext: ToolPermissionContext = {
    additionalWorkingDirectories: new Map(),
    mode: (opts.permissionMode || 'bypassPermissions') as any,
    alwaysAllowRules:
      opts.permissionMode === 'bypassPermissions'
        ? ({ command: opts.allowedTools } as any)
        : ({} as any),
    alwaysDenyRules: {} as any,
    alwaysAskRules: {} as any,
    isBypassPermissionsModeAvailable: true,
  } as any;

  // Reuse CLI's getTools() — this imports the full tool registry
  let tools: Tools;
  try {
    tools = getTools(permissionContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load CLI tool registry for desktop server: ${message}`);
  }

  let current: AppState = buildDefaultAppState(opts, permissionContext, tools);

  function setAppStateFn(f: (prev: AppState) => AppState): void {
    current = f(current);
  }

  return { appState: current, setAppStateFn };
}

function buildDefaultAppState(
  opts: HeadlessStateOptions,
  permissionContext: ToolPermissionContext,
  tools: Tools,
): AppState {
  return {
    // Core fields used by QueryEngine
    messages: [],
    sessionId: `server-${randomUUID()}`,
    cwd: opts.cwd,
    permissionMode: opts.permissionMode as any,

    // Tool permission context — must match CLI structure
    toolPermissionContext: permissionContext,

    // Tools — real tool array from getTools()
    tools,

    // File state cache
    readFileCache: {} as Record<string, unknown>,

    // Settings stub
    settings: {
      model: opts.model,
      apiKey: opts.apiKey,
      baseUrl: opts.baseURL,
      permissionMode: opts.permissionMode,
      allowedTools: opts.allowedTools,
    },

    // Hooks — must be a real Map, accessed by processUserInput + hook helpers
    sessionHooks: new Map(),
    hooksEnabled: false,
    proactiveActive: false,

    // Stub fields (QueryEngine doesn't consume these directly)
    commands: [],
    mcpClients: [],
    mcpServerStatuses: [],
    // MCP — tool/command/resource aggregation. All sub-fields are iterated
    // via .map()/.forEach()/.some() during system prompt assembly and tool
    // discovery — must be real iterables, not undefined.
    mcp: {
      tools: new Map(),
      servers: new Map(),
      commands: new Map(),
      resources: new Map(),
      clients: [] as any[],
      enabledTools: [] as any[],
    },
    agents: [],
    fastMode: false,
    isBareMode: false,
    theme: 'dark',
    plugins: [],
    skills: [],
    stats: undefined as any,
    fpsMetrics: undefined as any,
    sessionSource: 'server' as any,
    conversationHistory: [],
    fileHistory: undefined as any,
    commitAttribution: undefined as any,
    autoCompact: undefined as any,
    thinkingConfig: { type: 'adaptive' } as any,
    userSpecifiedModel: opts.model,
    fallbackModel: undefined,
    maxTurns: 10,
    maxBudgetUsd: undefined,
    taskBudget: undefined,
    jsonSchema: undefined,
    replayUserMessages: false,
    includePartialMessages: false,
    setSDKStatus: undefined as any,
    orphanedPermission: undefined,
    abortController: undefined,
    verbose: false,
    appendSystemPrompt: '',
    customSystemPrompt: '',
    initialMessages: [],
  } as unknown as AppState;
}

/**
 * Create a CanUseTool function that respects the permission mode.
 *
 * In server mode, bypassPermissions means all tools are allowed.
 * The desktop client handles permissions via its own UI layer.
 */
export function createCanUseTool(
  _appState: AppState,
  _setAppState: (f: (prev: AppState) => AppState) => void,
): CanUseToolFn {
  return async (_tool, _input, _toolUseContext) => {
    return { behavior: 'allow' };
  };
}
