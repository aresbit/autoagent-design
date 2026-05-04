import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  clearHandoffQuickResume,
  readHandoffFile,
  resolveHandoffPath,
} from '../../utils/handoffResume.js'

const MAX_HANDOFF_CHARS = 60000

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  try {
    const { absolutePath, relativePath } = await resolveHandoffPath(args)
    const content = await readHandoffFile(absolutePath)
    const truncated =
      content.length > MAX_HANDOFF_CHARS
        ? content.slice(0, MAX_HANDOFF_CHARS) +
          '\n\n[Truncated to fit context window.]'
        : content

    const nextInput = [
      `Resume from this handoff file: ${relativePath}`,
      '',
      'First, briefly summarize current state and immediate next step from the handoff, then continue execution.',
      '',
      '--- Handoff Content ---',
      truncated,
      '--- End Handoff Content ---',
    ].join('\n')

    clearHandoffQuickResume()
    onDone(`Loaded handoff from ${relativePath}.`, {
      display: 'system',
      shouldQuery: false,
      nextInput,
      submitNextInput: true,
    })
  } catch (error) {
    onDone(
      `Failed to load handoff: ${error instanceof Error ? error.message : String(error)}`,
      { display: 'system' },
    )
  }

  return null
}
