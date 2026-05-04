import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'fs/promises'
import { join, basename, dirname, relative, resolve } from 'path'
import { existsSync } from 'fs'
import { MEMORY_TYPES, type MemoryType } from '../../memdir/memoryTypes.js'
import { getAutoMemPath } from '../../memdir/paths.js'

export interface Memory {
  id: string
  type: MemoryType
  name: string
  description: string
  content: string
  tags?: string[]
  createdAt: Date
  updatedAt: Date
  filePath: string
}

export interface MemoryIndexEntry {
  id: string
  type: string
  name: string
  description: string
  filePath: string
  createdAt: Date
}

export class MemoryStore {
  private memoryDir: string
  private indexFile: string

  constructor(memoryDir?: string) {
    // Default memory directory: ~/.claude/projects/<encoded-project-path>/memory/
    // For now, use a simpler approach: project root/.claude/memory/
    this.memoryDir = memoryDir || this.getDefaultMemoryDir()
    this.indexFile = join(this.memoryDir, 'MEMORY.md')
  }

  private getDefaultMemoryDir(): string {
    // Use the same auto-memory directory as the rest of the system
    return getAutoMemPath()
  }

  private async ensureMemoryDir(): Promise<void> {
    if (!existsSync(this.memoryDir)) {
      await mkdir(this.memoryDir, { recursive: true })
    }
  }

  private generateMemoryId(type: string, name: string): string {
    const timestamp = Date.now()
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    return `${type}_${sanitizedName}_${timestamp}`
  }

  private generateFilename(memory: Omit<Memory, 'id' | 'filePath' | 'createdAt' | 'updatedAt'>): string {
    const timestamp = Date.now()
    const sanitizedName = memory.name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    return `${memory.type}_${sanitizedName}_${timestamp}.md`
  }

  private formatMemoryFile(memory: Omit<Memory, 'filePath'>): string {
    const frontmatter = `---
name: ${memory.name}
description: ${memory.description}
type: ${memory.type}
---

${memory.content}
`
    return frontmatter
  }

  private parseMemoryFile(content: string, filePath: string): Memory | null {
    try {
      const lines = content.split('\n')
      if (!lines[0].startsWith('---')) return null

      let frontmatterEnd = 1
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith('---')) {
          frontmatterEnd = i
          break
        }
      }

      const frontmatterLines = lines.slice(1, frontmatterEnd)
      const memoryContent = lines.slice(frontmatterEnd + 1).join('\n').trim()

      const frontmatter: Record<string, string> = {}
      for (const line of frontmatterLines) {
        const match = line.match(/^(\w+):\s*(.+)$/)
        if (match) {
          const [, key, value] = match
          frontmatter[key] = value
        }
      }

      const filename = basename(filePath, '.md')
      const [type, ...nameParts] = filename.split('_')
      const name = nameParts.join('_').replace(/_(\d+)$/, '') // Remove timestamp

      return {
        id: filename,
        type: type as Memory['type'],
        name: frontmatter.name || name,
        description: frontmatter.description || '',
        content: memoryContent,
        createdAt: new Date(), // Would parse from filename timestamp in real implementation
        updatedAt: new Date(),
        filePath
      }
    } catch (error) {
      console.error('Failed to parse memory file:', error)
      return null
    }
  }

  async saveMemory(
    type: Memory['type'],
    name: string,
    description: string,
    content: string,
    tags?: string[]
  ): Promise<Memory> {
    await this.ensureMemoryDir()

    const filename = this.generateFilename({ type, name, description, content, tags })
    const filePath = join(this.memoryDir, filename)
    const id = this.generateMemoryId(type, name)

    const memory: Omit<Memory, 'filePath'> = {
      id,
      type,
      name,
      description,
      content,
      tags,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const fileContent = this.formatMemoryFile(memory)
    await writeFile(filePath, fileContent, 'utf-8')

    // Update index
    await this.updateIndex({
      id,
      type,
      name,
      description,
      filePath,
      createdAt: memory.createdAt
    })

    return { ...memory, filePath }
  }

  private async updateIndex(entry: MemoryIndexEntry): Promise<void> {
    await this.ensureMemoryDir()

    let indexContent = ''
    if (existsSync(this.indexFile)) {
      indexContent = await readFile(this.indexFile, 'utf-8')
    }

    const indexLine = `- [${entry.name}](${basename(entry.filePath)}) — ${entry.description}\n`
    indexContent += indexLine

    await writeFile(this.indexFile, indexContent, 'utf-8')
  }

  async searchMemories(query: string, type?: string, limit: number = 20): Promise<Memory[]> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return []
    }

    const files = await readdir(this.memoryDir)
    const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    const memories: Memory[] = []
    for (const file of memoryFiles) {
      if (memories.length >= limit) break

      const filePath = join(this.memoryDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const memory = this.parseMemoryFile(content, filePath)

        if (memory) {
          // Simple text search in content
          const searchableText = `${memory.name} ${memory.description} ${memory.content}`.toLowerCase()
          if (searchableText.includes(query.toLowerCase())) {
            if (!type || memory.type === type) {
              memories.push(memory)
            }
          }
        }
      } catch (error) {
        console.error(`Failed to read memory file ${file}:`, error)
      }
    }

    return memories
  }

  async listMemories(offset: number = 0, limit: number = 20): Promise<Memory[]> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return []
    }

    const files = await readdir(this.memoryDir)
    const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    // Sort by modification time (newest first)
    const filesWithStats = await Promise.all(
      memoryFiles.map(async (file) => {
        const filePath = join(this.memoryDir, file)
        const stats = await stat(filePath)
        return { file, mtime: stats.mtime, filePath }
      })
    )

    filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    const memories: Memory[] = []
    for (let i = offset; i < Math.min(offset + limit, filesWithStats.length); i++) {
      const { filePath } = filesWithStats[i]
      try {
        const content = await readFile(filePath, 'utf-8')
        const memory = this.parseMemoryFile(content, filePath)
        if (memory) {
          memories.push(memory)
        }
      } catch (error) {
        console.error(`Failed to read memory file ${filePath}:`, error)
      }
    }

    return memories
  }

  async getMemory(id: string): Promise<Memory | null> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return null
    }

    // Look for file with matching id (filename without extension)
    const files = await readdir(this.memoryDir)
    const matchingFile = files.find(f => f.startsWith(id) || f === `${id}.md`)

    if (!matchingFile) {
      return null
    }

    const filePath = join(this.memoryDir, matchingFile)
    try {
      const content = await readFile(filePath, 'utf-8')
      return this.parseMemoryFile(content, filePath)
    } catch (error) {
      console.error(`Failed to read memory file ${filePath}:`, error)
      return null
    }
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return false
    }

    // Look for file with matching id (filename without extension)
    const files = await readdir(this.memoryDir)
    const matchingFile = files.find(f => f.startsWith(id) || f === `${id}.md`)

    if (!matchingFile) {
      return false
    }

    const filePath = join(this.memoryDir, matchingFile)
    try {
      await unlink(filePath)

      // Also try to remove from index (simplified - we'll just regenerate index)
      await this.regenerateIndex()

      return true
    } catch (error) {
      console.error(`Failed to delete memory file ${filePath}:`, error)
      return false
    }
  }

  async updateMemory(
    id: string,
    updates: Partial<{
      name: string
      description: string
      content: string
      tags: string[]
    }>
  ): Promise<Memory | null> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return null
    }

    // Find existing memory
    const files = await readdir(this.memoryDir)
    const matchingFile = files.find(f => f.startsWith(id) || f === `${id}.md`)

    if (!matchingFile) {
      return null
    }

    const filePath = join(this.memoryDir, matchingFile)
    try {
      const content = await readFile(filePath, 'utf-8')
      const existing = this.parseMemoryFile(content, filePath)

      if (!existing) {
        return null
      }

      // Merge updates
      const updatedMemory: Omit<Memory, 'filePath'> = {
        ...existing,
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        content: updates.content ?? existing.content,
        tags: updates.tags ?? existing.tags,
        updatedAt: new Date(),
      }

      // Write back to same file
      const fileContent = this.formatMemoryFile(updatedMemory)
      await writeFile(filePath, fileContent, 'utf-8')

      // Regenerate index
      await this.regenerateIndex()

      return { ...updatedMemory, filePath }
    } catch (error) {
      console.error(`Failed to update memory file ${filePath}:`, error)
      return null
    }
  }

  private async regenerateIndex(): Promise<void> {
    await this.ensureMemoryDir()

    if (!existsSync(this.memoryDir)) {
      return
    }

    const files = await readdir(this.memoryDir)
    const memoryFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    const indexEntries: string[] = []

    for (const file of memoryFiles) {
      const filePath = join(this.memoryDir, file)
      try {
        const content = await readFile(filePath, 'utf-8')
        const memory = this.parseMemoryFile(content, filePath)

        if (memory) {
          const indexLine = `- [${memory.name}](${basename(filePath)}) — ${memory.description}\n`
          indexEntries.push(indexLine)
        }
      } catch (error) {
        console.error(`Failed to read memory file ${file} for index regeneration:`, error)
      }
    }

    const indexContent = indexEntries.join('')
    await writeFile(this.indexFile, indexContent, 'utf-8')
  }
}