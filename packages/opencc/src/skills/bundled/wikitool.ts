import { registerBundledSkill } from '../bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'

// Wikitool技能 - 获取网页内容保存到wiki知识库
const WIKITOOL_DESCRIPTION = `
- 获取网页内容并保存到个人wiki知识库 ~/yyswiki/raw_sources/
- 可将内容保存为记忆文件，实现持久化知识存储
- 集成LLM Wiki模式，用于构建个人知识库
- 自动按类别组织内容（文章、论文、笔记、图片）
- 更新wiki日志并维护文件结构

## 使用方法

Wikitool从URL获取内容并保存到个人wiki知识库。
这支持"LLM Wiki"模式，获取的内容成为不断增长、有组织的知识库的一部分，
而不仅仅是临时的聊天内容。

## 工作流程

1. **获取内容**：使用WebFetchTool获取和处理网页内容
2. **保存到Wiki**：将清理后的markdown保存到 ~/yyswiki/raw_sources/{category}/
3. **保存记忆**：可选创建带有元数据和摘要的记忆文件
4. **更新日志**：添加条目到wiki/log.md用于跟踪

## 与LLM Wiki模式集成

此工具支持三层LLM Wiki架构：
- **原始源**：保存获取的内容到 ~/yyswiki/raw_sources/
- **Wiki层**：内容可由LLM处理为结构化的wiki页面
- **记忆层**：创建记忆文件实现知识持久化

## 最佳实践

- 使用描述性标题以便更好组织
- 添加相关标签进行分类
- 选择适当的类别（文章、论文、笔记、图片）
- 对重要内容启用记忆保存以实现持久化

## 示例用例

- **研究**：保存学术论文和文章，构建研究知识库
- **学习**：保存教程和文档供未来参考
- **个人笔记**：保存重要信息到个人wiki
- **内容策展**：构建有用网络资源的集合
`

export function registerWikitoolSkill() {
  registerBundledSkill({
    name: 'wikitool',
    description: '获取网页内容并保存到个人wiki知识库',
    aliases: ['wiki'],
    userInvocable: true,
    async getPromptForCommand(args, context) {
      // 解析参数：格式为 "url title [description] [category] [tags]"
      const parts = args.trim().split(/\s+/)
      const url = parts[0] || ''
      const title = parts[1] || 'Untitled'
      const description = parts[2] || ''
      const category = parts[3] || 'article'
      const tags = parts.slice(4).join(', ')

      return [
        {
          type: 'text',
          text: `${WIKITOOL_DESCRIPTION}

## 当前操作
URL: ${url || '未提供'}
标题: ${title}
描述: ${description || '未提供'}
类别: ${category}
标签: ${tags || '无'}

## 指令
请使用wikitool工具获取并保存此内容到wiki知识库。
确保提供完整的输入参数，包括URL、标题、描述（可选）、类别和标签（可选）。

工具参数：
- url: ${url}
- title: ${title}
- description: ${description || ''}
- category: ${category}
- tags: ${tags ? tags.split(/\s*,\s*/) : []}
- saveMemory: true
- memoryType: project

如果URL无效或缺失，请询问用户提供有效的URL。
`
        }
      ]
    }
  })
}
