/**
 * KimiTool 使用示例
 *
 * 此文件展示了如何在 Claude Code 中使用 KimiTool 进行各种操作。
 * KimiTool 提供了与 Kimi 网页版 API 兼容的功能，包括令牌管理、对话完成等。
 *
 * 注意：使用 KimiTool 需要有效的 refresh_token，可以通过以下方式获取：
 * 1. 从 Chrome 浏览器登录 kimi.moonshot.cn 后，通过 CDP 会话获取
 * 2. 手动从浏览器开发者工具的 Application -> Local Storage 中获取
 *
 * 所有操作都通过 Claude Code 的工具调用系统执行，而不是直接导入模块。
 */

/**
 * 示例 1: 从多个令牌中随机选择一个令牌
 *
 * 当你有多个 refresh_token 时，可以使用 pick_token 动作随机选择一个。
 * 这在负载均衡或故障转移时很有用。
 */
const pickTokenExample = {
  action: 'pick_token' as const,
  authorization: 'Bearer token1,token2,token3', // 多个令牌用逗号分隔
};

/**
 * 示例 2: 构建标准的 Authorization 头部
 *
 * 将逗号分隔的令牌列表转换为标准的 Authorization 头部格式。
 */
const buildHeaderExample = {
  action: 'build_auth_header' as const,
  authorization: 'Bearer token1,token2,token3',
};

/**
 * 示例 3: 检查令牌是否有效
 *
 * 验证 refresh_token 是否仍然有效，避免使用过期令牌。
 */
const checkTokenExample = {
  action: 'check_token_live' as const,
  token: 'Bearer your_refresh_token_here', // 或直接使用令牌字符串
  timeoutMs: 15000, // 超时时间（毫秒）
};

/**
 * 示例 4: 从 Chrome DevTools Protocol 会话获取令牌
 *
 * 自动从已登录 kimi.moonshot.cn 的 Chrome 标签页获取 refresh_token。
 * 需要 Chrome 运行且已登录 Kimi。
 */
const fromCdpSessionExample = {
  action: 'from_cdp_session' as const,
  // target: 'abc123', // 可选：CDP 目标前缀，如不指定则自动查找 Kimi 标签页
  localStorageKey: 'refresh_token', // localStorage 中的键名
};

/**
 * 示例 5: 聊天完成（非流式）
 *
 * 发送消息给 Kimi 并获取完整的回复。
 * 支持文件上传（通过 URL 或 base64）和联网搜索。
 */
const chatCompletionExample = {
  action: 'chat_completion' as const,
  authorization: 'Bearer your_refresh_token_here',
  model: 'kimi', // 模型名称，默认为 'kimi'
  messages: [
    {
      role: 'user' as const,
      content: '请用 Python 写一个快速排序算法，并添加详细注释。',
    },
  ],
  use_search: true, // 是否启用联网搜索
  // conversation_id: 'existing_conversation_id', // 可选：继续现有对话
  cleanup_conversation: true, // 是否在完成后删除临时对话
};

/**
 * 示例 6: 聊天完成（流式）
 *
 * 与示例 5 类似，但返回流式结果，包含多个 chunk。
 * 适用于需要显示打字机效果或实时处理的应用。
 */
const chatCompletionStreamExample = {
  action: 'chat_completion_stream' as const,
  authorization: 'Bearer your_refresh_token_here',
  model: 'kimi',
  messages: [
    {
      role: 'user' as const,
      content: '请解释一下 Transformer 模型的基本原理。',
    },
  ],
  use_search: true,
  // conversation_id: 'existing_conversation_id',
  cleanup_conversation: true,
};

/**
 * 示例 7: 带有文件上传的聊天
 *
 * KimiTool 支持上传文件进行分析，支持以下格式：
 * 1. 网络文件 URL（图片、PDF、文本等）
 * 2. base64 编码的数据（data:image/png;base64,...）
 */
const chatWithFileExample = {
  action: 'chat_completion' as const,
  authorization: 'Bearer your_refresh_token_here',
  model: 'kimi',
  messages: [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: '请分析这张图片中的内容：',
        },
        {
          type: 'image_url' as const,
          image_url: {
            url: 'https://example.com/image.png', // 图片 URL
          },
        },
      ],
    },
  ],
  use_search: false,
};

/**
 * 实际使用示例：在 Claude Code 中调用 KimiTool
 *
 * 在 Claude Code 的对话中，你可以直接使用 kimitool 工具。
 * 例如，在回复中嵌入工具调用：
 *
 * ```typescript
 * // 假设这是 Claude Code 的工具调用
 * const toolCall = {
 *   name: 'kimitool',
 *   input: chatCompletionExample, // 使用上面的示例输入
 * };
 * ```
 *
 * 或者在代码中通过工具系统调用：
 *
 * ```typescript
 * // 在工具处理逻辑中
 * const result = await kimiTool.call(chatCompletionExample);
 * ```
 */

/**
 * 错误处理建议
 *
 * 1. 令牌过期：当收到 401 错误时，需要重新获取有效的 refresh_token
 * 2. 网络超时：适当增加 timeoutMs 参数
 * 3. 文件大小限制：单个文件不能超过 100MB
 * 4. CDP 连接失败：确保 Chrome 正在运行且已登录 Kimi
 */

console.log('KimiTool 示例代码已准备好。在实际使用前，请替换示例中的令牌为有效的 refresh_token。');

export {}; // 确保这是 ES 模块