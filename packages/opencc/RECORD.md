# Claude Code 项目运行记录

> 项目: `/Users/konghayao/code/ai/claude-code`
> 日期: 2026-03-31
> 包管理器: bun

---

## 一、项目目标

**将 claude-code 项目运行起来，必要时可以删减次级能力。**

这是 Anthropic 官方 Claude Code CLI 工具的源码反编译/逆向还原项目。

### 核心保留能力

- API 通信（Anthropic SDK / Bedrock / Vertex）
- Bash/FileRead/FileWrite/FileEdit 等核心工具
- REPL 交互界面（ink 终端渲染）
- 对话历史与会话管理
- 权限系统（基础）
- Agent/子代理系统

### 已删减的次级能力

| 模块 | 处理方式 |
|------|----------|
| Computer Use (`@ant/computer-use-*`) | stub |
| Claude for Chrome (`@ant/claude-for-chrome-mcp`) | stub |
| Magic Docs / Voice Mode / LSP Server | 移除 |
| Analytics / GrowthBook / Sentry | 空实现 |
| Plugins/Marketplace / Desktop Upsell | 移除 |
| Ultraplan / Tungsten / Auto Dream | 移除 |
| MCP OAuth/IDP | 简化 |
| DAEMON / BRIDGE / BG_SESSIONS / TEMPLATES 等 | feature flag 关闭 |

---

## 二、当前状态：Dev 模式已可运行

```bash
# dev 运行
bun run dev
# 直接运行
bun run src/entrypoints/cli.tsx
# 测试 -p 模式
echo "say hello" | bun run src/entrypoints/cli.tsx -p
# 构建
bun run build
```

| 测试 | 结果 |
|------|------|
| `--version` | `2.1.87 (Claude Code)` |
| `--help` | 完整帮助信息输出 |
| `-p` 模式 | 成功调用 API 返回响应 |

### TS 类型错误说明

~~仍有 ~1341 个 tsc 错误~~ → 经过系统性类型修复，已降至 **~294 个**（减少 78%）。剩余错误分散在小文件中，均为反编译产生的源码级类型问题（`unknown`/`never`/`{}`），**不影响 Bun 运行时**。

---

## 三、关键修复记录

### 3.1 自动化 stub 生成

通过 3 个脚本自动处理了缺失模块问题：
- `scripts/create-type-stubs.mjs` — 生成 1206 个 stub 文件
- `scripts/fix-default-stubs.mjs` — 修复 120 个默认导出 stub
- `scripts/fix-missing-exports.mjs` — 补全 81 个模块的 161 个缺失导出

### 3.2 手动类型修复

- `src/types/global.d.ts` — MACRO 宏、内部函数声明
- `src/types/internal-modules.d.ts` — `@ant/*` 等私有包类型声明
- `src/entrypoints/sdk/` — 6 个 SDK 子模块 stub
- 泛型类型修复（DeepImmutable、AttachmentMessage 等）
- 4 个 `export const default` 非法语法修复

### 3.3 运行时修复

**Commander 非法短标志**：`-d2e, --debug-to-stderr` → `--debug-to-stderr`（反编译错误）

**`bun:bundle` 运行时 Polyfill**（`src/entrypoints/cli.tsx` 顶部）：
```typescript
const feature = (_name: string) => false;  // 所有 feature flag 分支被跳过
(globalThis as any).MACRO = { VERSION: "2.1.87", ... };  // 绕过版本检查
```

---

## 四、关键文件清单

| 文件 | 用途 |
|------|------|
| `src/entrypoints/cli.tsx` | 入口文件（含 MACRO/feature polyfill） |
| `src/main.tsx` | 主 CLI 逻辑（Commander 定义） |
| `src/types/global.d.ts` | 全局变量/宏声明 |
| `src/types/internal-modules.d.ts` | 内部 npm 包类型声明 |
| `src/entrypoints/sdk/*.ts` | SDK 类型 stub |
| `src/types/message.ts` | Message 系列类型 stub |
| `scripts/create-type-stubs.mjs` | 自动 stub 生成脚本 |
| `scripts/fix-default-stubs.mjs` | 修复默认导出 stub |
| `scripts/fix-missing-exports.mjs` | 补全缺失导出 |

---

## 五、Monorepo 改造（2026-03-31）

### 5.1 背景

`color-diff-napi` 原先是手工放在 `node_modules/` 下的 stub 文件，导出的是普通对象而非 class，导致 `new ColorDiff(...)` 报错：
```
ERROR Object is not a constructor (evaluating 'new ColorDiff(patch, firstLine, filePath, fileContent)')
```
同时 `@ant/*`、其他 `*-napi` 包也只有 `declare module` 类型声明，无运行时实现。

### 5.2 方案

将项目改造为 **Bun workspaces monorepo**，所有内部包统一放在 `packages/` 下，通过 `workspace:*` 依赖解析。

### 5.3 创建的 workspace 包

| 包名 | 路径 | 类型 |
|------|------|------|
| `color-diff-napi` | `packages/color-diff-napi/` | 完整实现（~1000行 TS，从 `src/native-ts/color-diff/` 移入） |
| `modifiers-napi` | `packages/modifiers-napi/` | stub（macOS 修饰键检测） |
| `audio-capture-napi` | `packages/audio-capture-napi/` | stub |
| `image-processor-napi` | `packages/image-processor-napi/` | stub |
| `url-handler-napi` | `packages/url-handler-napi/` | stub |
| `@ant/claude-for-chrome-mcp` | `packages/@ant/claude-for-chrome-mcp/` | stub |
| `@ant/computer-use-mcp` | `packages/@ant/computer-use-mcp/` | stub（含 subpath exports: sentinelApps, types） |
| `@ant/computer-use-input` | `packages/@ant/computer-use-input/` | stub |
| `@ant/computer-use-swift` | `packages/@ant/computer-use-swift/` | stub |

### 5.4 新增的 npm 依赖

| 包名 | 原因 |
|------|------|
| `@opentelemetry/semantic-conventions` | 构建报错缺失 |
| `fflate` | `src/utils/dxt/zip.ts` 动态 import |
| `vscode-jsonrpc` | `src/services/lsp/LSPClient.ts` import |
| `@aws-sdk/credential-provider-node` | `src/utils/proxy.ts` 动态 import |

### 5.5 关键变更

- `package.json`：添加 `workspaces`，添加所有 workspace 包和缺失 npm 依赖
- `src/types/internal-modules.d.ts`：删除已移入 monorepo 的 `declare module` 块，仅保留 `bun:bundle`、`bun:ffi`、`@anthropic-ai/mcpb`
- `src/native-ts/color-diff/` → `packages/color-diff-napi/src/`：移动并内联了对 `stringWidth` 和 `logError` 的依赖
- 删除 `node_modules/color-diff-napi/` 手工 stub

### 5.6 构建验证

```
$ bun run build
Bundled 5326 modules in 491ms
  cli.js  25.74 MB  (entry point)
```

---

## 六、系统性类型修复（2026-03-31）

### 6.1 背景

反编译产生的源码存在 ~1341 个 tsc 类型错误，主要成因：
- `unknown` 类型上的属性访问（714 个，占 54%）
- 类型赋值不兼容（212 个）
- 参数类型不匹配（140 个）
- 不可能的字面量比较（106 个，如 `"external" === 'ant'`）

### 6.2 修复策略

通过 4 轮并行 agent（每轮 7 个）系统性修复，**从 1341 降至 ~294**（减少 78%）。

#### 根因修复（影响面最大）

| 修复 | 影响 |
|------|------|
| `useAppState<R>` 添加泛型签名 (`AppState.tsx`) | 消除全局大量 `unknown` 返回值 |
| `Message` 类型重构 (`message.ts`) | content 改为 `string \| ContentBlockParam[] \| ContentBlock[]`；添加 `MessageType` 扩展联合；`GroupedToolUseMessage`/`CollapsedReadSearchGroup` 结构化 |
| `SDKAssistantMessageError` 命名冲突修复 (`coreTypes.generated.ts`) | 解决 37 个 errors.ts 类型错误 |
| SDK 消息类型增强 (`coreTypes.generated.ts`) | `SDKAssistantMessage`/`SDKUserMessage` 等添加具体字段声明 |
| `NonNullableUsage` 扩展 (`sdkUtilityTypes.ts`) | 添加 snake_case 属性声明 |

#### 批量模式修复

| 模式 | 修复方式 | 数量 |
|------|----------|------|
| `"external" === 'ant'` 编译常量比较 | `("external" as string) === 'ant'` | ~60 处 |
| `unknown` 属性访问 | 精确类型断言（`as SomeType`） | ~400 处 |
| `message.content` union 无法调用数组方法 | `Array.isArray()` 守卫 | ~80 处 |
| stub 包缺失方法/类型 | 补全 stub 类型声明 | ~15 个包 |

#### Stub 包类型补全

| 包 | 补全内容 |
|----|----------|
| `@ant/computer-use-swift` | `ComputerUseAPI` 完整接口（apps/display/screenshot） |
| `@ant/computer-use-input` | `ComputerUseInputAPI` 完整接口 |
| `audio-capture-napi` | 4 个函数签名 |

### 6.3 修复的关键文件

| 文件 | 修复错误数 |
|------|-----------|
| `src/screens/REPL.tsx` | ~100 |
| `src/utils/hooks.ts` | ~81 |
| `src/utils/sessionStorage.ts` | ~58 |
| `src/components/PromptInput/` | ~45 |
| `src/services/api/errors.ts` | ~37 |
| `src/utils/computerUse/executor.ts` | ~36 |
| `src/utils/messages.ts` | ~83 |
| `src/QueryEngine.ts` | ~39 |
| `src/services/api/claude.ts` | ~35 |
| `src/cli/print.ts` + `structuredIO.ts` | ~46 |
| 其他 ~50 个文件 | ~487 |
