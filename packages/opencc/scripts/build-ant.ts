#!/usr/bin/env bun

import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { parseSync } from '@swc/core'

type CliOptions = {
  keepTemp: boolean
  outDir?: string
  installDeps: boolean
}

type Span = { start: number; end: number }

function collectExternalLiteralSpans(node: unknown, spans: Span[]): void {
  if (node === null || node === undefined) return

  if (Array.isArray(node)) {
    for (const item of node) {
      collectExternalLiteralSpans(item, spans)
    }
    return
  }

  if (typeof node !== 'object') return

  const record = node as Record<string, unknown>
  if (
    record.type === 'StringLiteral' &&
    record.value === 'external' &&
    typeof record.span === 'object' &&
    record.span !== null
  ) {
    const span = record.span as Record<string, unknown>
    if (typeof span.start === 'number' && typeof span.end === 'number') {
      spans.push({ start: span.start, end: span.end })
    }
  }

  for (const key of Object.keys(record)) {
    collectExternalLiteralSpans(record[key], spans)
  }
}

function parseArgs(argv: string[]): CliOptions {
  let keepTemp = false
  let outDir: string | undefined
  let installDeps = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--keep-temp') {
      keepTemp = true
      continue
    }
    if (arg === '--install') {
      installDeps = true
      continue
    }
    if (arg === '--out-dir') {
      outDir = argv[i + 1]
      i += 1
      continue
    }
  }

  return { keepTemp, outDir, installDeps }
}

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`Command failed (${code}): ${cmd.join(' ')}`)
  }
}

async function collectSourceFiles(srcRoot: string): Promise<string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('**/*.{ts,tsx}')
  for await (const file of glob.scan(srcRoot)) {
    files.push(join(srcRoot, file))
  }
  return files
}

async function transformSourceTree(projectRoot: string): Promise<number> {
  const srcRoot = join(projectRoot, 'src')
  const files = await collectSourceFiles(srcRoot)
  let total = 0

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const isTsx = file.endsWith('.tsx')
    const ast = parseSync(source, {
      syntax: 'typescript',
      tsx: isTsx,
      comments: true,
      target: 'es2022',
    })
    const spans: Span[] = []
    collectExternalLiteralSpans(ast, spans)
    total += spans.length

    if (spans.length > 0) {
      let outputBytes = Buffer.from(source, 'utf8')
      const sorted = [...new Map(spans.map(s => [`${s.start}:${s.end}`, s])).values()]
        .sort((a, b) => b.start - a.start)
      for (const span of sorted) {
        const startByte = span.start - 1
        const endByte = span.end - 1
        if (startByte < 0 || endByte > outputBytes.length || startByte >= endByte) {
          continue
        }
        const literal = outputBytes.subarray(startByte, endByte).toString('utf8')
        if (literal !== '"external"' && literal !== "'external'") {
          continue
        }
        const quote = literal.startsWith("'") ? "'" : '"'
        const replacementBytes = Buffer.from(`${quote}ant${quote}`, 'utf8')
        outputBytes = Buffer.concat([
          outputBytes.subarray(0, startByte),
          replacementBytes,
          outputBytes.subarray(endByte),
        ])
      }
      await writeFile(file, outputBytes.toString('utf8'), 'utf8')
    }
  }

  return total
}

async function copyProjectToTemp(srcRoot: string, targetRoot: string): Promise<void> {
  await cp(srcRoot, targetRoot, {
    recursive: true,
    preserveTimestamps: true,
    filter: from => {
      const rel = relative(srcRoot, from)
      if (rel === '') return true
      const top = rel.split('/')[0]
      if (top === '.git' || top === 'node_modules' || top === 'dist') {
        return false
      }
      return true
    },
  })
}

async function ensureNodeModules(tempRoot: string, srcRoot: string): Promise<void> {
  const target = join(tempRoot, 'node_modules')
  const source = join(srcRoot, 'node_modules')
  await symlink(source, target, 'dir')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const sourceRoot = process.cwd()
  const tempRoot =
    options.outDir ??
    (await mkdtemp(join(tmpdir(), 'opencc-ant-build-')))

  if (options.outDir) {
    await rm(tempRoot, { recursive: true, force: true })
    await mkdir(tempRoot, { recursive: true })
  }

  console.log(`[build-ant] source: ${sourceRoot}`)
  console.log(`[build-ant] temp:   ${tempRoot}`)

  await copyProjectToTemp(sourceRoot, tempRoot)

  if (options.installDeps) {
    await run(['bun', 'install'], tempRoot)
  } else {
    await ensureNodeModules(tempRoot, sourceRoot)
  }

  const replacements = await transformSourceTree(tempRoot)
  console.log(`[build-ant] replaced string literals: ${replacements}`)

  await run(['bun', 'run', 'build'], tempRoot)
  console.log(`[build-ant] build output: ${join(tempRoot, 'dist')}`)

  if (!options.keepTemp && !options.outDir) {
    await rm(tempRoot, { recursive: true, force: true })
    console.log('[build-ant] temp directory removed')
  } else {
    console.log('[build-ant] temp directory retained')
  }
}

void main().catch(error => {
  console.error(`[build-ant] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
