import { registerBundledSkill } from '../bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'

// 小说生成技能
// 基于 openstory 项目的小说生成逻辑，采用三步流程：
// 1. 创意提炼 (extract_idea)
// 2. 故事核心 (core_seed)
// 3. 小说整体设定 (novel_meta)

// 提示词定义
const PROMPTS = {
  // 创意提炼
  extract_idea_prompt_base: `你是一名资深小说编辑, 请从用户提供的创意描述中提炼出清晰的小说构思要素。

用户创意:
{user_idea}

请理解用户想表达的故事情节方向, 并进行合理补全与归纳。
剧情深度要能匹配{number_of_chapters}章（每章{words_per_chapter}字）的小说篇幅。

提炼要求:
1. 剧情: 描绘故事的主要情节、故事走向和核心冲突
2. 类型: 选择最合适的小说类型（如玄幻、科幻、都市、悬疑等）
3. 基调: 整体情绪（如热血、黑暗、轻松、搞笑等）
4. 目标读者: 大致读者群体（如男频、女频、青少年等）
5. 核心设想: 用几句话描述故事的核心设想

如果用户描述不完整, 可以合理推断, 但要保持逻辑一致。`,

  extract_idea_prompt_with_schema_suffix: `请只提炼出故事构思要素, 不要输出任何额外内容。`,

  extract_idea_prompt_without_schema_suffix: `请严格输出 JSON, 不要输出任何额外内容:
{
  "plot": "剧情概括，描述故事的主要情节、故事走向和核心冲突，字数限制不超过500字",
  "genre": "小说类型，如玄幻、科幻、都市、悬疑、历史、仙侠等，字数限制不超过20字",
  "tone": "整体基调，如热血、黑暗、轻松、搞笑、治愈、压抑等，字数限制不超过20字",
  "target_audience": "目标读者，如男频、女频、青少年等，字数限制不超过20字",
  "core_idea": "核心设想，字数限制不超过250字"
}`,

  // 故事核心
  core_seed_prompt_base: `作为专业作家, 请用"雪花写作法"第一步构建故事核心。

剧情: {plot}
类型: {genre}
基调: {tone}
目标读者: {target_audience}
核心设想: {core_idea}
篇幅: 约{number_of_chapters}章（每章{words_per_chapter}字）

请用单句公式概括故事本质, 例如:
"当[主角]遭遇[核心事件], 必须[关键行动], 否则[灾难后果]；与此同时, [隐藏的更大危机]正在发酵。"

要求:
1. 必须包含显性冲突与潜在危机
2. 体现人物核心驱动力
3. 暗示世界观关键矛盾
4. 使用30-100字精准表达`,

  core_seed_prompt_with_schema_suffix: `请只生成故事核心内容。`,

  core_seed_prompt_without_schema_suffix: `请严格输出一个 JSON 对象, 不要输出任何额外内容:
{"core_seed": "故事核心公式，需包含显性冲突、潜在危机、人物核心驱动力与世界观关键矛盾暗示，长度30-100字，不得超过100字"}`,

  // 小说整体设定
  novel_meta_prompt_base: `你是一名专业小说策划人, 请基于以下信息构建小说的整体设定。

基础信息:
剧情: {plot}
类型: {genre}
基调: {tone}
目标读者: {target_audience}
核心设想: {core_idea}
篇幅: 约{number_of_chapters}章（每章{words_per_chapter}字）

故事核心:
{core_seed}

请在保持逻辑一致的前提下, 进行创造性扩展, 生成完整的小说基础信息。

生成要求:

1. 标题:
   - 具有吸引力和传播性
   - 符合该类型读者审美

2. 副标题:
   - 补充核心冲突或主题
   - 具有一定文学感或商业感

3. 引言:
   - 100-300字
   - 引入故事，吸引读者阅读兴趣

4. 简介:
   - 100-600字
   - 需清晰呈现主线冲突与悬念

5. 世界观:
   - 说明世界规则 / 力量体系 / 社会结构
   - 不少于100字

6. 创作风格:
   - 如"偏黑暗现实""轻快幽默""史诗宏大"等

7. 叙事视角:
   - 如"第一人称 / 第三人称有限视角 / 全知视角"

8. 时代背景:
   - 如"架空古代 / 未来星际 / 现代都市 / 末世废土"等

9. 标签:
   - 3-5个, 概括小说核心元素, 如"硬科幻""冒险""爱情"等

要求:
- 所有设定必须围绕故事核心展开
- 风格与类型保持一致
- 不要出现自相矛盾`,

  novel_meta_prompt_with_schema_suffix: `请只生成小说整体设定内容。`,

  novel_meta_prompt_without_schema_suffix: `请严格输出 JSON, 不要输出任何额外内容:
{
  "title": "小说主标题，具有吸引力和传播性，符合类型读者审美，字数限制不超过20字",
  "subtitle": "副标题，补充核心冲突或主题，具有一定文学感或商业感，字数限制不超过20字",
  "introduction": "引言，100-300字，引入故事，吸引读者阅读兴趣",
  "summary": "小说简介，100-600字，需清晰呈现主线冲突与悬念",
  "worldview": "世界观，说明世界规则 / 力量体系 / 社会结构等，字数限制不超过800字",
  "writing_style": "创作风格，如"偏黑暗现实""轻快幽默""史诗宏大"等，字数限制不超过40字",
  "narrative_pov": "叙事视角，只能为第一人称、第三人称有限视角、全知视角之一",
  "era_background": "时代背景，如"架空古代 / 未来星际 / 现代都市 / 末世废土"等，字数限制不超过40字",
  "tags": ["标签1", "标签2", "标签3"]
}`
}

// 类型定义
interface ExtractIdea {
  plot: string
  genre: string
  tone: string
  target_audience: string
  core_idea: string
}

interface CoreSeed {
  core_seed: string
}

interface NovelMeta {
  title: string
  subtitle: string
  introduction: string
  summary: string
  worldview: string
  writing_style: string
  narrative_pov: '第一人称' | '第三人称有限视角' | '全知视角'
  era_background: string
  tags: string[]
}

// 参数解析
interface NovelGenerationArgs {
  user_idea: string
  number_of_chapters?: number
  words_per_chapter?: number
  temperature?: number
  top_p?: number
  max_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  system_prompt?: string
}

function parseArgs(args: string): NovelGenerationArgs | { error: string } {
  const trimmed = args.trim()
  if (!trimmed) {
    return { error: '请提供创意描述。例如: /novel "一个关于未来世界的科幻故事"' }
  }

  // 简单解析：第一个参数是创意描述，后续可选参数使用键值对
  // 格式: "创意描述" chapters=100 words=3000 temperature=0.7
  const parts = trimmed.match(/"[^"]+"|'[^']+'|\S+/g) || []
  if (parts.length === 0) {
    return { error: '请提供创意描述。' }
  }

  let user_idea = parts[0]
  // 去除引号
  if ((user_idea.startsWith('"') && user_idea.endsWith('"')) ||
      (user_idea.startsWith("'") && user_idea.endsWith("'"))) {
    user_idea = user_idea.slice(1, -1)
  }

  const result: NovelGenerationArgs = {
    user_idea,
    number_of_chapters: 100,
    words_per_chapter: 3000
  }

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    const match = part.match(/^(\w+)=(\d+(\.\d+)?|"[^"]+"|'[^']+'|\S+)$/)
    if (match) {
      const key = match[1] as keyof NovelGenerationArgs
      let value: any = match[2]

      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      // 转换数字
      if (!isNaN(Number(value)) && value !== '') {
        value = Number(value)
      }

      // 布尔值
      if (value === 'true') value = true
      if (value === 'false') value = false

      result[key] = value
    }
  }

  return result
}

function formatPrompt(template: string, params: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match
  })
}

export function registerNovelGeneratorSkill(): void {
  registerBundledSkill({
    name: 'novel',
    description: 'AI小说生成器：通过三步流程从创意生成完整小说设定。使用方式: /novel "创意描述" [chapters=100] [words=3000] [temperature=0.7]',
    aliases: ['novel-generator', '小说生成', '小说创作'],
    argumentHint: '"创意描述" [章节数=100] [每章字数=3000] [temperature=0.7]',
    userInvocable: true,
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    async getPromptForCommand(args: string, context: ToolUseContext) {
      const parsed = parseArgs(args)
      if ('error' in parsed) {
        return [{ type: 'text', text: `错误: ${parsed.error}` }]
      }

      const params = parsed
      const chapters = params.number_of_chapters || 100
      const wordsPerChapter = params.words_per_chapter || 3000

      // 构建完整提示
      const prompt = `# AI小说生成器

我将指导你完成三步小说生成流程。请严格按照以下步骤执行：

## 步骤1: 创意提炼
${formatPrompt(PROMPTS.extract_idea_prompt_base, {
  user_idea: params.user_idea,
  number_of_chapters: chapters,
  words_per_chapter: wordsPerChapter
})}

${PROMPTS.extract_idea_prompt_without_schema_suffix}

## 步骤2: 故事核心
（等待步骤1完成后，使用其输出继续）

## 步骤3: 小说整体设定
（等待步骤2完成后，使用其输出继续）

## 重要提示
1. 请按顺序执行三个步骤
2. 每个步骤输出严格的JSON格式
3. 确保三个步骤之间的逻辑一致性
4. 最终输出完整的小说设定

现在开始步骤1。请根据用户创意生成 ExtractIdea JSON 对象。`

      return [{ type: 'text', text: prompt }]
    },
  })
}