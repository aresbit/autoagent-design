import { appendFile, mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'
import { MemoryStore } from '../MemoryTool/MemoryStore.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { fetchContent } from '../WebFetchTool/utils.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import { DESCRIPTION } from './prompt.js'

const WIKI_TOOL_NAME = 'wikitool'

const WIKI_CATEGORIES = ['article', 'paper', 'note', 'image'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    title: z.string().describe('Title for the saved content'),
    description: z.string().optional().describe('Brief description of the content'),
    category: z
      .string()
      .optional()
      .default('article')
      .describe('Content category: article, paper, note, or image'),
    tags: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .describe('Tags for categorization. Supports array or comma-separated string.'),
    saveMemory: z
      .boolean()
      .default(true)
      .describe('Whether to save a companion memory file'),
    memoryType: z
      .string()
      .optional()
      .default('project')
      .describe('Memory type when saveMemory is true (user, feedback, project, or reference)'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    sourceFile: z.string().describe('Path to saved source file'),
    memoryFile: z.string().optional().describe('Path to saved memory file'),
    url: z.string().describe('The URL that was fetched'),
    title: z.string().describe('Title of the content'),
    message: z.string().describe('Status message'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function sanitizeFilename(title: string): string {
  const sanitized = title
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()

  return sanitized || 'untitled'
}

function getCategoryDirectory(category: Input['category']): string {
  switch (category) {
    case 'paper':
      return 'papers'
    case 'note':
      return 'notes'
    case 'image':
      return 'images'
    case 'article':
    default:
      return 'articles'
  }
}

function normalizeCategory(category: string | undefined): (typeof WIKI_CATEGORIES)[number] {
  const value = (category || 'article').trim().toLowerCase()
  if (value === 'paper' || value === 'papers') return 'paper'
  if (value === 'note' || value === 'notes') return 'note'
  if (value === 'image' || value === 'images' || value === 'img') return 'image'
  return 'article'
}

function normalizeTags(tags: Input['tags']): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) {
    return tags.map(tag => tag.trim()).filter(Boolean)
  }
  return tags
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
}

function normalizeMemoryType(memoryType: string | undefined): MemoryType {
  const cleaned = (memoryType || 'project').trim().replace(/^['"]|['"]$/g, '')
  const normalized = cleaned.toLowerCase()
  return MEMORY_TYPES.includes(normalized as MemoryType)
    ? (normalized as MemoryType)
    : 'project'
}

function getWikiBasePath(): string {
  return process.env.WIKI_BASE_PATH || join(homedir(), 'yyswiki')
}

function formatTags(tags: string[] | undefined): string {
  return tags && tags.length > 0 ? tags.join(', ') : 'none'
}

function buildMarkdownContent(
  input: Input,
  fetchedContent: string,
  fetchedAt: string,
): string {
  const header = [
    `# ${input.title}`,
    '',
    input.description ? `> ${input.description}` : '',
    input.description ? '' : '',
    `**Source URL**: ${input.url}`,
    `**Fetched**: ${fetchedAt}`,
    `**Category**: ${input.category}`,
    input.tags && input.tags.length > 0 ? `**Tags**: ${input.tags.join(', ')}` : '',
    '',
    '---',
    '',
  ].filter(Boolean)

  return `${header.join('\n')}${fetchedContent.endsWith('\n') ? '' : '\n'}${fetchedContent}`
}

function buildMemoryContent(
  input: Input,
  sourceFile: string,
  savedAt: string,
): string {
  return `## Wiki Content: ${input.title}

**URL**: ${input.url}
**Category**: ${input.category}
**Saved**: ${savedAt}
**Source File**: ${sourceFile}

### Summary
${input.description || 'Content saved from web source'}

### Key Points
- Source: ${input.url}
- Type: ${input.category}
- Tags: ${formatTags(input.tags)}

### Why:
This content was fetched and saved as part of building a personal knowledge base.

### How to apply:
Use the source file for the full markdown content and this memory as a durable index entry.
`
}

function createAbortController(parentSignal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (parentSignal.aborted) {
    controller.abort()
    return controller
  }

  parentSignal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller
}

export const WikiTool = buildTool({
  name: WIKI_TOOL_NAME,
  searchHint: 'fetch and save content to wiki knowledge base',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get inputJSONSchema() {
    const schema = zodToJsonSchema(inputSchema())
    schema.type = 'object'
    return schema
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'WikiTool'
  },
  shouldDefer: false,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.url} -> ${input.title}`
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, context) {
    const abortController = createAbortController(context.abortController.signal)
    const normalizedCategory = normalizeCategory(input.category)
    const normalizedTags = normalizeTags(input.tags)
    const normalizedMemoryType = normalizeMemoryType(input.memoryType)
    const now = new Date()
    const isoTimestamp = now.toISOString()
    const isoDate = isoTimestamp.split('T')[0] || isoTimestamp
    const wikiBasePath = getWikiBasePath()
    const categoryDir = getCategoryDirectory(normalizedCategory)
    const sourceDir = join(wikiBasePath, 'raw_sources', categoryDir)
    const filename = `${sanitizeFilename(input.title)}.md`
    const sourceFile = join(sourceDir, filename)

    try {
      const fetched = await fetchContent(input.url, abortController.signal, {
        mode: 'auto',
        format: 'markdown',
      })

      await mkdir(sourceDir, { recursive: true })
      await writeFile(
        sourceFile,
        buildMarkdownContent(
          {
            ...input,
            category: normalizedCategory,
            tags: normalizedTags,
          },
          fetched.content,
          isoDate,
        ),
        'utf-8',
      )

      let memoryFile: string | undefined
      if (input.saveMemory) {
        const memoryStore = new MemoryStore()
        const memory = await memoryStore.saveMemory(
          normalizedMemoryType,
          `wiki_${sanitizeFilename(input.title)}`,
          `Wiki content: ${input.title} from ${input.url}`,
          buildMemoryContent(
            {
              ...input,
              category: normalizedCategory,
              tags: normalizedTags,
            },
            sourceFile,
            isoTimestamp,
          ),
          ['wiki', normalizedCategory, ...normalizedTags],
        )
        memoryFile = memory.filePath
      }

      const logDir = join(wikiBasePath, 'wiki')
      await mkdir(logDir, { recursive: true })
      await appendFile(
        join(logDir, 'log.md'),
        `## [${isoDate}] ingest | ${input.title}
- Source: ${input.url}
- Category: ${normalizedCategory}
- File: ${filename}
- Memory: ${input.saveMemory ? 'saved' : 'not saved'}

`,
        'utf-8',
      )

      return {
        data: {
          success: true,
          sourceFile,
          memoryFile,
          url: input.url,
          title: input.title,
          message: `Saved "${input.title}" to ${sourceFile}`,
        },
      }
    } catch (error) {
      return {
        data: {
          success: false,
          sourceFile: '',
          url: input.url,
          title: input.title,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const output = content as Output
    const summary = output.success
      ? `Saved "${output.title}" to wiki`
      : `Failed to save "${output.title}" to wiki: ${output.message}`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [{ type: 'text', text: summary }],
    }
  },
} satisfies ToolDef<InputSchema, Output>)
