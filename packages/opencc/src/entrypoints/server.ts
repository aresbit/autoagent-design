/**
 * App Server — JSON-RPC over stdio (JSONL) server entrypoint.
 *
 * Started via `cli.js --server`. Spawns once, stays alive, multiplexes multiple
 * QueryEngine instances (Threads) within a single long-running process.
 *
 * Protocol: JSON-RPC 2.0 semantics without the "jsonrpc" header on the wire.
 * Wire format: newline-delimited JSON (JSONL). One message per line.
 * Requests carry `id` and `method`; responses echo `id` with `result` or `error`.
 * Notifications carry no `id`.
 *
 * Lifecycle:
 *   1. Client spawns `bun cli.js --server` with stdio pipes
 *   2. Client sends `initialize` → Server responds with metadata
 *   3. Client sends `initialized` (notification)
 *   4. Client sends `thread/start` to create a conversation session
 *   5. Client sends `turn/start` to submit user input and begin the agent loop
 *   6. Server streams `item/*` and `turn/*` notifications back
 *   7. On SIGTERM or stdin EOF, server drains active turns and exits
 */

import { randomUUID } from 'node:crypto';
import type { SDKMessage } from './sdk/coreTypes.js';

// ============================================================================
// Types
// ============================================================================

type JsonRpcRequest = {
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: string };
};

type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type ThreadState = {
  threadId: string;
  createdAt: number;
  config: ThreadConfig;
  queryEngine: any; // QueryEngine — dynamically instantiated
  messages: any[];   // accumulated SDKMessage history
  aborter: AbortController;
  activeTurnId: string | null;
  _activeTool?: { name: string; input: string }; // per-turn tool tracking
};

type ThreadConfig = {
  model: string;
  cwd: string;
  maxTurns: number;
  permissionMode: string;
  allowedTools: string[];
  appendSystemPrompt: string;
  apiKey: string;
  baseURL: string;
  providerId: string;
  apiType: string;
};

interface ThreadInfo {
  id: string;
  createdAt: number;
  model: string;
  cwd: string;
  activeTurnId: string | null;
}

// ============================================================================
// JSONL Transport
// ============================================================================

function send(response: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id: number | string, code: number, message: string, data?: string): void {
  send({ id, error: { code, message, data } });
}

function notify(method: string, params?: Record<string, unknown>): void {
  send({ method, params });
}

// ============================================================================
// ThreadManager
// ============================================================================

class ThreadManager {
  private threads = new Map<string, ThreadState>();
  private initialized = false;
  private clientName = '';

  constructor(private serverVersion: string) {}

  markInitialized(clientName: string): void {
    this.initialized = true;
    this.clientName = clientName;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async handleInitialize(
    id: number | string,
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (this.initialized) {
      sendError(id, -32000, 'Already initialized');
      return;
    }
    const clientInfo = (params?.clientInfo as Record<string, string>) || {};
    this.markInitialized(clientInfo.name || 'unknown');

    send({
      id,
      result: {
        platformFamily: process.platform,
        platformOs: process.platform,
        serverVersion: this.serverVersion,
        capabilities: {
          threads: true,
          streaming: true,
        },
      },
    });
  }

  async handleThreadStart(
    id: number | string,
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    const config: ThreadConfig = {
      model: (params?.model as string) || 'claude-sonnet-4-6',
      cwd: (params?.cwd as string) || process.cwd(),
      maxTurns: (params?.maxTurns as number) || 1024,
      permissionMode: (params?.permissionMode as string) || 'bypassPermissions',
      allowedTools: Array.isArray(params?.allowedTools)
        ? (params.allowedTools as string[])
        : ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'],
      appendSystemPrompt: (params?.appendSystemPrompt as string) || '',
      apiKey: (params?.apiKey as string) || process.env.ANTHROPIC_API_KEY || '',
      baseURL: (params?.baseURL as string) || process.env.ANTHROPIC_BASE_URL || '',
      providerId: (params?.providerId as string) || 'anthropic',
      apiType: (params?.apiType as string) || 'anthropic-messages',
    };

    const threadId = randomUUID();
    const thread: ThreadState = {
      threadId,
      createdAt: Date.now(),
      config,
      queryEngine: null, // lazily created on first turn
      messages: [],
      aborter: new AbortController(),
      activeTurnId: null,
    };

    this.threads.set(threadId, thread);

    send({
      id,
      result: {
        thread: {
          id: threadId,
          createdAt: thread.createdAt,
          model: config.model,
          cwd: config.cwd,
          status: 'idle',
        },
      },
    });

    // Notify subscribers
    notify('thread/started', {
      threadId,
      model: config.model,
      cwd: config.cwd,
    });
  }

  async handleTurnStart(
    id: number | string,
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    const threadId = params?.threadId as string;
    const input = params?.input as string;

    if (!threadId || !input) {
      sendError(id, -32602, 'Missing required params: threadId, input');
      return;
    }

    const thread = this.threads.get(threadId);
    if (!thread) {
      sendError(id, -32001, `Thread not found: ${threadId}`);
      return;
    }

    if (thread.activeTurnId) {
      sendError(id, -32002, `Thread ${threadId} already has an active turn`);
      return;
    }

    const turnId = randomUUID();
    thread.activeTurnId = turnId;

    // Reset aborter for new turn
    if (thread.aborter.signal.aborted) {
      thread.aborter = new AbortController();
    }

    // Send the turn acknowledgment
    send({
      id,
      result: {
        turn: {
          id: turnId,
          status: 'inProgress',
          items: [],
        },
      },
    });

    // Notify turn started
    notify('turn/started', {
      threadId,
      turn: { id: turnId, status: 'inProgress', items: [] },
    });

    // Fire-and-forget: run the agent loop asynchronously
    this.runAgentLoop(thread, turnId, input)
      .then(() => {
        thread.activeTurnId = null;
        notify('thread/status/changed', { threadId, status: { type: 'idle' } });
      })
      .catch((err) => {
        thread.activeTurnId = null;
        notify('turn/completed', {
          threadId,
          turn: {
            id: turnId,
            status: 'failed',
            items: [],
            error: { message: err instanceof Error ? err.message : String(err) },
          },
        });
        notify('thread/status/changed', {
          threadId,
          status: { type: 'systemError', message: err instanceof Error ? err.message : String(err) },
        });
      });
  }

  async handleTurnInterrupt(
    id: number | string,
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    const threadId = params?.threadId as string;
    if (!threadId) {
      sendError(id, -32602, 'Missing required param: threadId');
      return;
    }

    const thread = this.threads.get(threadId);
    if (!thread) {
      sendError(id, -32001, `Thread not found: ${threadId}`);
      return;
    }

    if (!thread.activeTurnId) {
      sendError(id, -32003, `No active turn on thread ${threadId}`);
      return;
    }

    thread.aborter.abort();
    send({ id, result: {} });
  }

  handleThreadList(id: number | string): void {
    const threads: ThreadInfo[] = [];
    for (const t of this.threads.values()) {
      threads.push({
        id: t.threadId,
        createdAt: t.createdAt,
        model: t.config.model,
        cwd: t.config.cwd,
        activeTurnId: t.activeTurnId,
      });
    }
    send({ id, result: { threads } });
  }

  handleThreadResume(
    id: number | string,
    params: Record<string, unknown> | undefined,
  ): void {
    const threadId = params?.threadId as string;
    if (!threadId) {
      sendError(id, -32602, 'Missing required param: threadId');
      return;
    }

    const thread = this.threads.get(threadId);
    if (!thread) {
      sendError(id, -32001, `Thread not found: ${threadId}`);
      return;
    }

    send({
      id,
      result: {
        thread: {
          id: thread.threadId,
          createdAt: thread.createdAt,
          model: thread.config.model,
          cwd: thread.config.cwd,
          status: thread.activeTurnId ? 'active' : 'idle',
        },
      },
    });
  }

  async shutdown(): Promise<void> {
    // Abort all active turns
    for (const thread of this.threads.values()) {
      if (thread.activeTurnId) {
        thread.aborter.abort();
      }
    }
    // Wait a tick for graceful cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.threads.clear();
  }

  // ============================================================================
  // Agent Loop — maps QueryEngine SDKMessage stream to JSON-RPC notifications
  // ============================================================================

  private async runAgentLoop(
    thread: ThreadState,
    turnId: string,
    input: string,
  ): Promise<void> {
    // Reuse existing QueryEngine across turns — submitMessage() is designed
    // to be called multiple times on the same instance, appending new user
    // input to mutableMessages. Creating a new engine each turn would pass
    // SDKMessage[] as initialMessages (Message[] expected), corrupting state.
    if (!thread.queryEngine) {
      // First turn: bootstrap config, import modules, create engine
      this.applyThreadEnvironment(thread.config);

      const { enableConfigs } = await import('../utils/config.js');
      enableConfigs();

      const { QueryEngine } = await import('../QueryEngine.js');
      const { createAppState, createCanUseTool } = await import('./server/headlessState.js');

      const { appState, setAppStateFn } = createAppState({
        cwd: thread.config.cwd,
        permissionMode: thread.config.permissionMode as any,
        allowedTools: thread.config.allowedTools,
        model: thread.config.model,
        apiKey: thread.config.apiKey,
        baseURL: thread.config.baseURL,
      });

      const canUseTool = createCanUseTool(appState, setAppStateFn);

      const engine = new QueryEngine({
        cwd: thread.config.cwd,
        tools: appState.tools,
        commands: [],
        mcpClients: [],
        agents: [],
        canUseTool,
        getAppState: () => appState,
        setAppState: setAppStateFn,
        initialMessages: [],
        readFileCache: appState.readFileCache || {},
        customSystemPrompt: undefined,
        appendSystemPrompt: thread.config.appendSystemPrompt,
        userSpecifiedModel: thread.config.model,
        maxTurns: thread.config.maxTurns,
        verbose: true,
        includePartialMessages: true,
        abortController: thread.aborter,
      });

      thread.queryEngine = engine;
    }

    const engine = thread.queryEngine;

    let currentAssistantItemId: string | null = null;

    try {
      for await (const msg of engine.submitMessage(input)) {
        // Map SDKMessage → JSON-RPC notifications
        switch (msg.type) {
          case 'stream_event': {
            const event = (msg as any).event;
            if (!currentAssistantItemId) {
              currentAssistantItemId = randomUUID();
              notify('item/started', {
                threadId: thread.threadId,
                turnId,
                item: {
                  id: currentAssistantItemId,
                  type: 'agentMessage',
                  text: '',
                  status: 'inProgress',
                },
              });
            }

            let delta = '';
            if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              delta = event.delta.text || '';
            } else if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
              delta = event.delta.thinking || '';
            } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              const block = event.content_block;
              thread._activeTool = { name: block.name, input: '' };
              this.notifyToolCall(thread.threadId, turnId, block.name);
            } else if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
              if (thread._activeTool) {
                thread._activeTool.input += event.delta.partial_json || '';
              }
            }

            if (delta) {
              notify('item/agentMessage/delta', {
                threadId: thread.threadId,
                turnId,
                itemId: currentAssistantItemId,
                delta,
              });
            }
            break;
          }

          case 'user': {
            if (!thread._activeTool && !this.isToolResultMessage(msg)) {
              break;
            }
            const toolName = thread._activeTool?.name || 'tool';
            const resultText = this.extractToolResultText(msg);
            thread._activeTool = undefined;

            // Emit tool output as a structured item. Do not append it to the
            // assistant delta stream; otherwise internal tool markers become
            // persisted assistant text in the desktop chat.
            const itemId = randomUUID();
            notify('item/started', {
              threadId: thread.threadId,
              turnId,
              item: { id: itemId, type: 'tool_result', toolName, content: resultText.slice(0, 1000), status: 'inProgress' },
            });
            notify('item/completed', {
              threadId: thread.threadId,
              turnId,
              item: { id: itemId, type: 'tool_result', toolName, content: resultText.slice(0, 1000), status: 'completed' },
            });
            break;
          }

          case 'partial_assistant': {
            if (!currentAssistantItemId) {
              currentAssistantItemId = randomUUID();
              notify('item/started', {
                threadId: thread.threadId,
                turnId,
                item: {
                  id: currentAssistantItemId,
                  type: 'agentMessage',
                  text: '',
                  status: 'inProgress',
                },
              });
            }
            const event = msg.event as any;
            let delta = '';

            // text_delta — normal streaming text
            if (event?.type === 'text_delta' && event.text) {
              delta = event.text;
            }
            // thinking — reasoning/thinking output
            else if (event?.type === 'thinking' && event.thinking) {
              delta = event.thinking;
            }
            // content_block_start — tool invocation begins
            else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              const blk = event.content_block;
              // Store partial tool info for the delta phase
              if (!thread._activeTool) thread._activeTool = { name: blk.name, input: '' };
              this.notifyToolCall(thread.threadId, turnId, blk.name);
            }
            // content_block_delta — tool input JSON streaming
            else if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
              if (thread._activeTool) {
                thread._activeTool.input += event.delta.partial_json || '';
              }
              // Don't stream partial JSON — only show on completion
              delta = '';
            }

            if (delta) {
              notify('item/agentMessage/delta', {
                threadId: thread.threadId,
                turnId,
                itemId: currentAssistantItemId,
                delta,
              });
            }
            break;
          }

          case 'assistant': {
            // Full assistant message — close current item or create new
            if (!currentAssistantItemId) {
              currentAssistantItemId = randomUUID();
              notify('item/started', {
                threadId: thread.threadId,
                turnId,
                item: {
                  id: currentAssistantItemId,
                  type: 'agentMessage',
                  text: '',
                  status: 'inProgress',
                },
              });
            }
            const content = msg.message?.content;
            const text = this.extractText(content);
            notify('item/completed', {
              threadId: thread.threadId,
              turnId,
              item: {
                id: currentAssistantItemId,
                type: 'agentMessage',
                text,
                status: 'completed',
              },
            });
            currentAssistantItemId = null;
            break;
          }

          case 'assistant_error': {
            notify('turn/completed', {
              threadId: thread.threadId,
              turn: {
                id: turnId,
                status: 'failed',
                items: [],
                error: {
                  message: String(msg.error || 'Assistant error'),
                  codexErrorInfo: 'Other',
                },
              },
            });
            return; // Stop processing
          }

          case 'result': {
            notify('turn/completed', {
              threadId: thread.threadId,
              turn: {
                id: turnId,
                status: 'completed',
                items: [],
                result: msg.result || msg.subtype || 'success',
              },
            });
            break;
          }

          case 'system':
          case 'status':
          case 'compact_boundary':
          case 'tool_progress':
            // Internal messages — forward as generic items for debugging
            break;

          default:
            // Unknown message types — log to stderr for debugging
            if (process.env.OPENCC_SERVER_VERBOSE) {
              process.stderr.write(
                `[server] unknown SDKMessage type: ${msg.type} ${JSON.stringify(msg).slice(0, 200)}\n`,
              );
            }
        }

        // Accumulate message history for context persistence
        thread.messages.push(msg);
      }
    } catch (err) {
      // Check if this was an abort
      if (thread.aborter.signal.aborted) {
        notify('turn/completed', {
          threadId: thread.threadId,
          turn: {
            id: turnId,
            status: 'interrupted',
            items: [],
          },
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[server] agent loop error: ${msg}\n`);
        if (err instanceof Error && err.stack) {
          process.stderr.write(`[server] stack: ${err.stack}\n`);
        }
        throw err;
      }
    } finally {
      if (currentAssistantItemId) {
        notify('item/completed', {
          threadId: thread.threadId,
          turnId,
          item: {
            id: currentAssistantItemId,
            type: 'agentMessage',
            text: '',
            status: 'interrupted',
          },
        });
      }
    }
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
        .map((block: any) => block.text)
        .join('\n');
    }
    if (content && typeof content === 'object' && 'text' in (content as any)) {
      return String((content as any).text);
    }
    return '';
  }

  private extractToolResultText(msg: SDKMessage): string {
    const candidate = (msg as any).content ?? (msg as any).message?.content ?? (msg as any).tool_use_result ?? msg;
    const text = this.extractContentText(candidate);
    if (text) return text;
    const json = JSON.stringify(candidate);
    return typeof json === 'string' ? json : '';
  }

  private isToolResultMessage(msg: SDKMessage): boolean {
    const content = (msg as any).content ?? (msg as any).message?.content;
    if (!Array.isArray(content)) return Boolean((msg as any).tool_use_result);
    return content.some((block: any) => block?.type === 'tool_result');
  }

  private extractContentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block?.type === 'text' && typeof block.text === 'string') return block.text;
          if (block?.type === 'tool_result') return this.extractContentText(block.content);
          if (typeof block?.content === 'string') return block.content;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  private notifyToolCall(threadId: string, turnId: string, toolName: string): void {
    const itemId = randomUUID();
    notify('item/started', {
      threadId,
      turnId,
      item: { id: itemId, type: 'tool_call', toolName, content: '', status: 'inProgress' },
    });
  }

  private applyThreadEnvironment(config: ThreadConfig): void {
    if (config.apiKey) process.env.ANTHROPIC_API_KEY = config.apiKey;
    if (config.baseURL) {
      process.env.ANTHROPIC_BASE_URL = normalizeAnthropicBaseURL(config.baseURL);
    }
    if (config.model) {
      process.env.ANTHROPIC_MODEL = config.model;
      process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = config.model;
    }
  }
}

function normalizeAnthropicBaseURL(baseURL: string): string {
  return baseURL.replace(/\/chat\/completions\/?$/, '').replace(/\/v1\/?$/, '');
}

// ============================================================================
// JSONL Reader & Router
// ============================================================================

export async function main(): Promise<void> {
  const VERSION = (globalThis as any).MACRO?.VERSION || '0.2.0';
  const manager = new ThreadManager(VERSION);

  // Graceful shutdown on SIGTERM / SIGINT
  let shuttingDown = false;
  const doShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await manager.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', doShutdown);
  process.on('SIGINT', doShutdown);

  // Use raw stdin buffering — bun's createInterface can double-emit lines
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  for await (const chunk of process.stdin) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed);
      } catch {
        process.stderr.write(`[server] invalid JSON: ${trimmed.slice(0, 100)}\n`);
        continue;
      }

      if (!request.method) continue;

      const { id, method, params } = request;

      try {
        if (method === 'initialized') continue;
        if (!id) continue;

        switch (method) {
          case 'initialize':
            await manager.handleInitialize(id, params);
            break;
          case 'thread/start':
            await manager.handleThreadStart(id, params);
            break;
          case 'turn/start':
            await manager.handleTurnStart(id, params);
            break;
          case 'turn/interrupt':
            await manager.handleTurnInterrupt(id, params);
            break;
          case 'thread/list':
            manager.handleThreadList(id);
            break;
          case 'thread/resume':
            manager.handleThreadResume(id, params);
            break;
          case 'shutdown':
            send({ id, result: {} });
            await doShutdown();
            return;
          default:
            sendError(id, -32601, `Method not found: ${method}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[server] error processing ${method}: ${message}\n`);
        if (id) sendError(id, -32603, message, 'Internal server error');
      }
    }
  }

  await doShutdown();
}

// eslint-disable-next-line custom-rules/no-top-level-side-effects
void main().catch((err) => {
  process.stderr.write(`[server] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
