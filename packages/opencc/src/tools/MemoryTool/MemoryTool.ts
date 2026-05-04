import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { MEMORY_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { MemoryStore, type Memory } from './MemoryStore.js'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'

// Input schemas for different actions
const saveInputSchema = z.strictObject({
  action: z.literal('save'),
  type: z.enum(MEMORY_TYPES).describe('Type of memory: user, feedback, project, or reference'),
  name: z.string().describe('Name/title of the memory'),
  description: z.string().describe('One-line description for relevance determination'),
  content: z.string().describe('Memory content (for feedback/project: structure as rule/fact, then Why: and How to apply:)'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
})

const searchInputSchema = z.strictObject({
  action: z.literal('search'),
  query: z.string().describe('Search query to match against name, description, or content'),
  type: z.enum(MEMORY_TYPES).optional().describe('Optional filter by memory type'),
  limit: z.number().optional().default(20).describe('Maximum number of results to return'),
})

const listInputSchema = z.strictObject({
  action: z.literal('list'),
  offset: z.number().optional().default(0).describe('Number of memories to skip'),
  limit: z.number().optional().default(20).describe('Maximum number of memories to return'),
})

const getInputSchema = z.strictObject({
  action: z.literal('get'),
  id: z.string().describe('Memory ID or filename (without .md extension)'),
})

const updateInputSchema = z.strictObject({
  action: z.literal('update'),
  id: z.string().describe('Memory ID or filename (without .md extension)'),
  name: z.string().optional().describe('Updated name/title'),
  description: z.string().optional().describe('Updated description'),
  content: z.string().optional().describe('Updated content'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
})

const deleteInputSchema = z.strictObject({
  action: z.literal('delete'),
  id: z.string().describe('Memory ID or filename (without .md extension)'),
})

const inputSchema = lazySchema(() =>
  z.discriminatedUnion('action', [
    saveInputSchema,
    searchInputSchema,
    listInputSchema,
    getInputSchema,
    updateInputSchema,
    deleteInputSchema,
  ])
)

type InputSchema = ReturnType<typeof inputSchema>

// Output schemas
const memoryOutputSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  filePath: z.string(),
})

const saveOutputSchema = z.object({
  action: z.literal('save'),
  memory: memoryOutputSchema,
})

const searchOutputSchema = z.object({
  action: z.literal('search'),
  memories: z.array(memoryOutputSchema),
  count: z.number(),
})

const listOutputSchema = z.object({
  action: z.literal('list'),
  memories: z.array(memoryOutputSchema),
  offset: z.number(),
  limit: z.number(),
  total: z.number(),
})

const getOutputSchema = z.object({
  action: z.literal('get'),
  memory: memoryOutputSchema.nullable(),
})

const updateOutputSchema = z.object({
  action: z.literal('update'),
  memory: memoryOutputSchema,
})

const deleteOutputSchema = z.object({
  action: z.literal('delete'),
  deleted: z.boolean(),
  id: z.string(),
})

const outputSchema = lazySchema(() =>
  z.union([
    saveOutputSchema,
    searchOutputSchema,
    listOutputSchema,
    getOutputSchema,
    updateOutputSchema,
    deleteOutputSchema,
  ])
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// Helper to convert Memory to serializable object
function memoryToSerializable(memory: Memory): z.infer<typeof memoryOutputSchema> {
  return {
    ...memory,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  }
}

export const MemoryTool = buildTool({
  name: MEMORY_TOOL_NAME,
  searchHint: 'manage persistent memory system',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
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
    return 'MemoryTool'
  },
  shouldDefer: true,
  isEnabled() {
    // Always enabled for now
    return true
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.action} memory`
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    const store = new MemoryStore()

    switch (input.action) {
      case 'save': {
        const memory = await store.saveMemory(
          input.type,
          input.name,
          input.description,
          input.content,
          input.tags
        )
        return {
          data: {
            action: 'save' as const,
            memory: memoryToSerializable(memory),
          },
        }
      }

      case 'search': {
        const memories = await store.searchMemories(input.query, input.type, input.limit)
        return {
          data: {
            action: 'search' as const,
            memories: memories.map(memoryToSerializable),
            count: memories.length,
          },
        }
      }

      case 'list': {
        const memories = await store.listMemories(input.offset, input.limit)
        return {
          data: {
            action: 'list' as const,
            memories: memories.map(memoryToSerializable),
            offset: input.offset,
            limit: input.limit,
            total: memories.length, // Note: this is just the returned count, not total count
          },
        }
      }

      case 'get': {
        const memory = await store.getMemory(input.id)
        return {
          data: {
            action: 'get' as const,
            memory: memory ? memoryToSerializable(memory) : null,
          },
        }
      }

      case 'update': {
        const updates: Partial<{
          name: string
          description: string
          content: string
          tags: string[]
        }> = {}

        if (input.name !== undefined) updates.name = input.name
        if (input.description !== undefined) updates.description = input.description
        if (input.content !== undefined) updates.content = input.content
        if (input.tags !== undefined) updates.tags = input.tags

        const updatedMemory = await store.updateMemory(input.id, updates)
        if (!updatedMemory) {
          throw new Error(`Memory with ID ${input.id} not found or could not be updated`)
        }

        return {
          data: {
            action: 'update' as const,
            memory: memoryToSerializable(updatedMemory),
          },
        }
      }

      case 'delete': {
        const deleted = await store.deleteMemory(input.id)
        return {
          data: {
            action: 'delete' as const,
            deleted,
            id: input.id,
          },
        }
      }

      default:
        throw new Error(`Unknown action: ${(input as any).action}`)
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const data = content as Output
    let message = ''

    switch (data.action) {
      case 'save':
        message = `Saved memory: ${data.memory.name} (${data.memory.type})`
        break
      case 'search':
        message = `Found ${data.count} memory${data.count === 1 ? '' : 'ies'} matching search`
        break
      case 'list':
        message = `Listed ${data.memories.length} memory${data.memories.length === 1 ? '' : 'ies'} (offset: ${data.offset}, limit: ${data.limit})`
        break
      case 'get':
        message = data.memory
          ? `Retrieved memory: ${data.memory.name}`
          : `Memory not found`
        break
      case 'update':
        message = `Updated memory: ${data.memory.name}`
        break
      case 'delete':
        message = data.deleted
          ? `Deleted memory ${data.id}`
          : `Failed to delete memory ${data.id}`
        break
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: message,
    }
  },
} satisfies ToolDef<InputSchema, Output>)