/**
 * Kimi 助手工具
 *
 * 此模块提供了使用 KimiTool 的高级封装，简化了常见操作。
 * 注意：KimiTool 是通过 Claude Code 的工具系统调用的，不能直接导入。
 * 这些函数返回的是工具输入对象，需要传递给工具调用系统。
 */

/**
 * Kimi 工具操作类型
 */
export type KimiAction =
  | 'pick_token'
  | 'build_auth_header'
  | 'check_token_live'
  | 'from_cdp_session'
  | 'chat_completion'
  | 'chat_completion_stream';

/**
 * 聊天消息类型
 */
export interface KimiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image_url' | 'file';
    text?: string;
    image_url?: { url: string };
    file_url?: { url: string };
  }>;
}

/**
 * 创建令牌选择请求
 * @param tokens 逗号分隔的 refresh_token 列表
 * @returns 工具输入对象
 */
export function createPickTokenRequest(tokens: string[]): { action: 'pick_token'; authorization: string } {
  return {
    action: 'pick_token',
    authorization: `Bearer ${tokens.join(',')}`,
  };
}

/**
 * 创建授权头构建请求
 * @param tokens 逗号分隔的 refresh_token 列表
 * @returns 工具输入对象
 */
export function createBuildHeaderRequest(tokens: string[]): { action: 'build_auth_header'; authorization: string } {
  return {
    action: 'build_auth_header',
    authorization: `Bearer ${tokens.join(',')}`,
  };
}

/**
 * 创建令牌状态检查请求
 * @param token refresh_token
 * @param timeoutMs 超时时间（毫秒，默认15000）
 * @returns 工具输入对象
 */
export function createCheckTokenRequest(token: string, timeoutMs = 15000): {
  action: 'check_token_live';
  token: string;
  timeoutMs: number;
} {
  return {
    action: 'check_token_live',
    token: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    timeoutMs,
  };
}

/**
 * 创建 CDP 会话令牌获取请求
 * @param target 可选的 CDP 目标前缀
 * @param localStorageKey localStorage 键名（默认 'refresh_token'）
 * @returns 工具输入对象
 */
export function createFromCdpSessionRequest(target?: string, localStorageKey = 'refresh_token'): {
  action: 'from_cdp_session';
  target?: string;
  localStorageKey: string;
} {
  return {
    action: 'from_cdp_session',
    target,
    localStorageKey,
  };
}

/**
 * 创建聊天完成请求（非流式）
 * @param tokens refresh_token 列表
 * @param messages 消息数组
 * @param options 可选配置
 * @returns 工具输入对象
 */
export function createChatCompletionRequest(
  tokens: string[],
  messages: KimiMessage[],
  options: {
    model?: string;
    useSearch?: boolean;
    conversationId?: string;
    cleanupConversation?: boolean;
  } = {}
): { action: 'chat_completion'; authorization: string; model: string; messages: any[]; use_search: boolean; conversation_id?: string; cleanup_conversation: boolean } {
  const selectedToken = tokens[Math.floor(Math.random() * tokens.length)];
  return {
    action: 'chat_completion',
    authorization: `Bearer ${tokens.join(',')}`,
    model: options.model || 'kimi',
    messages: messages as any[],
    use_search: options.useSearch ?? true,
    conversation_id: options.conversationId,
    cleanup_conversation: options.cleanupConversation ?? true,
  };
}

/**
 * 创建聊天完成请求（流式）
 * @param tokens refresh_token 列表
 * @param messages 消息数组
 * @param options 可选配置
 * @returns 工具输入对象
 */
export function createChatCompletionStreamRequest(
  tokens: string[],
  messages: KimiMessage[],
  options: {
    model?: string;
    useSearch?: boolean;
    conversationId?: string;
    cleanupConversation?: boolean;
  } = {}
): { action: 'chat_completion_stream'; authorization: string; model: string; messages: any[]; use_search: boolean; conversation_id?: string; cleanup_conversation: boolean } {
  const selectedToken = tokens[Math.floor(Math.random() * tokens.length)];
  return {
    action: 'chat_completion_stream',
    authorization: `Bearer ${tokens.join(',')}`,
    model: options.model || 'kimi',
    messages: messages as any[],
    use_search: options.useSearch ?? true,
    conversation_id: options.conversationId,
    cleanup_conversation: options.cleanupConversation ?? true,
  };
}

/**
 * 创建简单文本聊天请求
 * @param token refresh_token
 * @param prompt 用户提示
 * @param useSearch 是否启用搜索（默认 true）
 * @returns 工具输入对象
 */
export function createSimpleChatRequest(
  token: string,
  prompt: string,
  useSearch = true
): ReturnType<typeof createChatCompletionRequest> {
  return createChatCompletionRequest([token], [{ role: 'user', content: prompt }], { useSearch });
}

/**
 * 创建代码生成请求
 * @param token refresh_token
 * @param language 编程语言
 * @param task 任务描述
 * @returns 工具输入对象
 */
export function createCodeGenerationRequest(
  token: string,
  language: string,
  task: string
): ReturnType<typeof createChatCompletionRequest> {
  const prompt = `请用 ${language} 编写代码：${task}\n要求：\n1. 代码要完整、可运行\n2. 添加必要的注释\n3. 考虑边界情况和错误处理\n4. 输出只包含代码和必要的说明`;
  return createSimpleChatRequest(token, prompt, false);
}

/**
 * 错误处理工具函数
 */
export class KimiError extends Error {
  constructor(
    message: string,
    public readonly action?: KimiAction,
    public readonly input?: any
  ) {
    super(message);
    this.name = 'KimiError';
  }
}

/**
 * 解析 KimiTool 输出结果
 * @param output 工具输出
 * @returns 解析后的结果
 */
export function parseKimiOutput(output: any): {
  action: KimiAction;
  data: any;
} {
  if (!output || typeof output !== 'object') {
    throw new KimiError('无效的输出格式');
  }

  const { action, ...data } = output;

  if (!action || typeof action !== 'string') {
    throw new KimiError('输出中缺少 action 字段');
  }

  return { action: action as KimiAction, data };
}

/**
 * 示例使用方式：
 *
 * ```typescript
 * // 1. 创建聊天请求
 * const request = createSimpleChatRequest(
 *   'your_refresh_token_here',
 *   '请用 Python 写一个快速排序算法'
 * );
 *
 * // 2. 在 Claude Code 中调用工具
 * // const result = await kimiTool.call(request);
 *
 * // 3. 解析结果
 * // const parsed = parseKimiOutput(result.data);
 * // console.log(parsed.data.choices[0].message.content);
 * ```
 */

export default {
  createPickTokenRequest,
  createBuildHeaderRequest,
  createCheckTokenRequest,
  createFromCdpSessionRequest,
  createChatCompletionRequest,
  createChatCompletionStreamRequest,
  createSimpleChatRequest,
  createCodeGenerationRequest,
  KimiError,
  parseKimiOutput,
};