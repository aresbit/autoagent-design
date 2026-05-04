import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../ink.js'
import type { ToolProgressData } from '../../Tool.js'
import type { ProgressMessage } from '../../types/message.js'
import type { Output } from './WikiTool.js'

export function renderToolUseMessage(
  input: Partial<{
    url: string
    title: string
  }>,
  options: {
    theme?: string
    verbose: boolean
  },
): React.ReactNode {
  if (!input.url && !input.title) {
    return null
  }

  if (options.verbose) {
    return `wiki save: ${input.title || 'untitled'} from ${input.url || 'unknown source'}`
  }

  return `📚 ${input.title || 'Save to wiki'}`
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text dimColor>Saving to wiki knowledge base…</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(
  result: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  options: {
    verbose: boolean
  },
): React.ReactNode {
  if (result.success) {
    if (options.verbose) {
      return (
        <Box flexDirection="column">
          <MessageResponse height={1}>
            <Text>
              ✅ Successfully saved "<Text bold>{result.title}</Text>" to wiki
            </Text>
          </MessageResponse>
          <MessageResponse height={1}>
            <Text dimColor>Source: {result.sourceFile}</Text>
          </MessageResponse>
          {result.memoryFile && (
            <MessageResponse height={1}>
              <Text dimColor>Memory: {result.memoryFile}</Text>
            </MessageResponse>
          )}
        </Box>
      )
    }

    return (
      <MessageResponse height={1}>
        <Text>
          ✅ Saved "<Text bold>{result.title}</Text>" to wiki
        </Text>
      </MessageResponse>
    )
  }

  return (
    <MessageResponse height={1}>
      <Text color="red">❌ Failed to save to wiki: {result.message}</Text>
    </MessageResponse>
  )
}