/**
 * Engine library entrypoint for embedding in Electron/Bun apps.
 *
 * Re-exports the core agent loop + tool system + context builder
 * without the CLI/Ink/REPL UI layer. All feature() flags resolve
 * to false at build time via the polyfill in cli.tsx.
 *
 * Build: bun build src/entrypoints/engine.ts --outdir dist --target node
 * Import: import { query, getTools, ... } from './dist/engine.js'
 */

// Runtime polyfill — MUST be first (mirrors cli.tsx)
const feature = (_name: string) => false;
if (typeof (globalThis as any).MACRO === 'undefined') {
  (globalThis as any).MACRO = {
    VERSION: '2.1.888',
    BUILD_TIME: new Date().toISOString(),
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    NATIVE_PACKAGE_URL: '',
    PACKAGE_URL: '',
    VERSION_CHANGELOG: '',
  };
}
(globalThis as any).BUILD_TARGET = 'external';
(globalThis as any).BUILD_ENV = 'production';
(globalThis as any).INTERFACE_TYPE = 'stdio';

// ---- Core agent loop ----
export { query } from '../query.js';
export type { QueryParams } from '../query.js';

// ---- Context & system prompt ----
export { getSystemContext, getUserContext, getGitStatus } from '../context.js';

// ---- Tools ----
export { getTools } from '../tools.js';
export { findToolByName } from '../Tool.js';
export type { Tool, ToolUseContext, Tools, ToolInputJSONSchema } from '../Tool.js';
export type { CanUseToolFn } from '../hooks/useCanUseTool.js';

// ---- Messages ----
export {
  createUserMessage,
  createSystemMessage,
  normalizeMessagesForAPI,
  createAssistantAPIErrorMessage,
} from '../utils/messages.js';

// ---- System prompt utilities ----
export { asSystemPrompt } from '../utils/systemPromptType.js';
export type { SystemPrompt } from '../utils/systemPromptType.js';

// ---- Message types ----
export type {
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  StreamEvent,
} from '../types/message.js';

// ---- Provider selection ----
export { getAPIProvider } from '../utils/model/providers.js';
