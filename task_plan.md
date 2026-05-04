# Task Plan: autoagent-design-opencc-migration

## Goal
将 opencc (claude-js) 集成为 Open Design 桌面设计软件的主 AI agent 大脑，完整的 Electron 桌面应用。

## Desktop 架构设计

```
┌─────────────────────────────────────────────────┐
│ Electron Desktop Shell (apps/desktop)           │
│ ┌─────────────────────────────────────────────┐ │
│ │ BrowserWindow 1280x900                      │ │
│ │ 加载 web URL → http://127.0.0.1:17573       │ │
│ │ title: "Open Design"                         │ │
│ │ macOS: hiddenInset titleBar                 │ │
│ │ sandbox: true, contextIsolation: true       │ │
│ └─────────────────────────────────────────────┘ │
│ IPC Server: /tmp/open-design/ipc/<ns>/desktop   │
│  .sock (JSON-RPC: status/eval/screenshot/click) │
└──────────────┬──────────────────────────────────┘
               │ sidecar IPC (web URL discovery)
┌──────────────▼──────────────────────────────────┐
│ Daemon (apps/daemon)                    :17456  │
│ Express server + agent spawner                  │
│ opencc → claude-stream.ts → SSE → Web UI        │
└─────────────────────────────────────────────────┘
```

## 启动方式

```bash
# 完整桌面应用（Electron）
ELECTRON_DISABLE_SANDBOX=1 pnpm tools-dev start --daemon-port 17456 --web-port 17573

# 仅网页版
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
```

## 已修复问题
- [x] kimi-desktop 自动拉起 → 移除 kimi agent 定义 (Electron 二进制不是 CLI)
- [x] Electron sandbox 权限 → 使用 ELECTRON_DISABLE_SANDBOX=1

## 已完成阶段

### Phase 1-2: 集成设计 + 实现 ✓
### Phase 3: 编译构建 ✓
### Phase 4: 桌面启动验证 ✓
### Phase 5: 问题修复 ✓
