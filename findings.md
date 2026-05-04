# Findings & Decisions: opencc Migration

## Current Status: Can compile & run

所有包 typecheck 通过（daemon, web, desktop, packaged, contracts, platform, sidecar, sidecar-proto, tools-dev, tools-pack, e2e）。

| 检查项 | 状态 |
|--------|------|
| daemon typecheck | OK |
| web typecheck | OK |
| desktop typecheck | OK |
| packaged typecheck | OK |
| contracts typecheck | OK |
| e2e typecheck | OK |
| daemon build (`tsc`) | OK |

## Build Toolchain Analysis

### 当前工具链 (autoagent-design)

| 层 | 运行时 | 构建工具 |
|----|--------|----------|
| daemon | Node.js ~24 | tsc |
| web | Node.js ~24 / Next.js 16 | tsc |
| desktop | Electron 41.3 / Node.js | tsc |
| opencc (新增) | **Bun >=1.2.0** | `bun build` |

### 参考工具链 (autoagent)

| 层 | 运行时 | 构建工具 |
|----|--------|----------|
| Electron main | Node.js | tsc |
| opencc engine | Bun | `bun build` → single 24MB bundle |
| 子进程 spawn | `bun dist/cli.js -p --output-format stream-json` | — |

### Bun 迁移策略

**关键约束**: opencc 必须在 Bun 上运行（使用了 Bun API），不可迁移到 Node.js。但项目其余部分不需要迁移到 Bun。

**推荐方案**: 混合工具链 — 保持 Node.js + pnpm 用于项目基础设施，引入 Bun 仅用于 opencc 的构建和运行。

```
项目构建:
  pnpm install          → Node.js 依赖
  pnpm build            → tsc 编译 daemon/desktop/web
  bun install           → opencc 依赖 (packages/opencc/)
  bun build             → opencc dist/cli.js (~24MB bundle)

运行时:
  守护进程 (Node.js) spawn opencc (Bun):
  bun packages/opencc/dist/cli.js -p --output-format stream-json --verbose
```

**为何不全量迁移到 Bun**:
1. Electron 内置 Node.js，无法替换为 Bun
2. Next.js 16 依赖 Node.js 特定 API
3. pnpm workspaces 在大型 monorepo 中比 bun workspaces 成熟
4. 参考项目 autoagent 自身也是混合架构（Electron=Node + opencc=Bun）

## opencc 集成设计

### 已完成: 守护进程 agent 定义

`apps/daemon/src/agents.ts` 新增:
- `id: 'opencc'` agent 定义，放在 AGENT_DEFS 首位（默认优先）
- `resolveOpenccPath(projectRoot)` — 多源二进制解析
- `spawnEnvForOpencc(...)` — opencc 子进程环境变量构建
- `spawnEnvForAgent` 更新支持 opencc

### opencc 子进程启动方式

守护进程 spawn 到 opencc 的调用链:
```
server.ts → spawn(resolvedBin, args, env)
  resolvedBin = "bun" (or "opencc" wrapper)
  args = ["packages/opencc/dist/cli.js", "-p", "--output-format", "stream-json", "--verbose", ...]
  env = { CLAUDE_CODE_ENTRYPOINT: "claude-desktop", ... }
```

### 流格式: 零修改复用

opencc 输出的 JSONL 与 Claude Code 完全兼容:
```
claude-stream.ts   ← 不修改，直接解析 opencc stdout
server.ts          ← 不修改，streamFormat dispatch 已覆盖
```

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| 混合工具链 (Node+Bun) | opencc 必须 Bun，其余项目必须 Node |
| opencc 作为默认 agent | 放在 AGENT_DEFS[0] 位置 |
| 复用 claude-stream-json 格式 | opencc JSONL 与 Claude Code 100% 兼容 |
| bypassPermissions 模式 | Web UI 无 TTY 交互能力 |
| 不修改 server.ts | streamFormat dispatch 已完全覆盖 |
