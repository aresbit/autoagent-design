import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../ink.js'
import type { ProgressMessage } from '../../types/message.js'
import type { MythosProgress, Input, Output } from './MythosTool.js'

export function userFacingName(): string {
  return 'Mythos'
}

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  const action = input.action ?? 'research'
  if (action === 'status') return 'Mythos status'
  if (action === 'continue') return 'Mythos continue research'
  if (action === 'clear') return 'Mythos clear workspace'
  const topic = input.topic?.trim()
  return topic ? `Mythos research: ${topic}` : 'Mythos deep research'
}

export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage<MythosProgress>[],
): React.ReactNode {
  if (progressMessages.length === 0) return null
  const last = progressMessages[progressMessages.length - 1]
  if (!last?.data || last.data.type !== 'mythos_progress') return null

  const { phase, depth, direction } = last.data
  let label = ''
  if (phase === 'prelude') label = 'Prelude: mapping landscape...'
  else if (phase === 'recurrent')
    label = `Recurrent depth ${depth ?? '?'}${direction ? `: ${direction}` : ''}`
  else if (phase === 'coda') label = 'Coda: synthesizing report...'

  return (
    <MessageResponse>
      <Text dimColor={true}>🔬 {label}</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  if (!output.success) {
    return (
      <MessageResponse>
        <Text color="red">❌ Mythos failed: {output.message}</Text>
      </MessageResponse>
    )
  }

  if (output.action === 'status') {
    return (
      <MessageResponse>
        <Box flexDirection="column">
          <Text>🔬 Mythos {output.mode}</Text>
          {typeof output.depthReached === 'number' && (
            <Text dimColor={true}>Depth: {output.depthReached}</Text>
          )}
          {typeof output.findingsCount === 'number' && (
            <Text dimColor={true}>Findings: {output.findingsCount}</Text>
          )}
        </Box>
      </MessageResponse>
    )
  }

  if (output.action === 'clear') {
    return (
      <MessageResponse>
        <Text>🧹 {output.message}</Text>
      </MessageResponse>
    )
  }

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text>🔬 Mythos research complete</Text>
        {typeof output.depthReached === 'number' && (
          <Text dimColor={true}>Depth reached: {output.depthReached}</Text>
        )}
        {typeof output.findingsCount === 'number' && (
          <Text dimColor={true}>Findings: {output.findingsCount}</Text>
        )}
        {output.reportPath && (
          <Text dimColor={true}>Report: {output.reportPath}</Text>
        )}
      </Box>
    </MessageResponse>
  )
}
