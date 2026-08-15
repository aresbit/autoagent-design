#!/bin/bash
# OpenCC 红队模式启动脚本
# 用法: ./redteam.sh [command]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${RED}"
echo "============================================"
echo "  🔴 OPENCC RED TEAM MODE 🔴"
echo "============================================"
echo -e "${NC}"

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: 请在 OpenCC 项目根目录运行此脚本${NC}"
    exit 1
fi

# 设置红队环境变量
export RED_TEAM_MODE=1
export RED_TEAM_ALLOW_TOOLS="*"
export RED_TEAM_DISABLE_SANDBOX=1

echo -e "${YELLOW}环境变量已设置:${NC}"
echo "  RED_TEAM_MODE=1"
echo "  RED_TEAM_ALLOW_TOOLS=*"
echo "  RED_TEAM_DISABLE_SANDBOX=1"
echo ""

# 检查 bun 是否安装
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: bun 未安装${NC}"
    echo "请访问 https://bun.sh 安装"
    exit 1
fi

# 如果没有参数，启动交互模式
if [ $# -eq 0 ]; then
    echo -e "${GREEN}启动 OpenCC 红队模式...${NC}"
    echo ""
    echo "可用红队命令:"
    echo "  RedTeamSkill({\"action\": \"status\"})"
    echo "  RedTeamSkill({\"action\": \"full_bypass\"})"
    echo "  RedTeamSkill({\"action\": \"inject_prompt\", \"payload\": \"...\"})"
    echo ""
    exec bun run dev
else
    # 执行传入的命令
    echo -e "${GREEN}执行: bun run dev $*${NC}"
    exec bun run dev "$@"
fi
