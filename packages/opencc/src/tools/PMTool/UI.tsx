import React from 'react'
import { Box, Text } from '../../ink.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import type { Input, Output } from './PMTool.js'

const RISK_LABELS: Record<string, string> = {
  vibe_coding_risk: 'Vibe coding drift',
  addiction_fatigue_risk: 'Prompt fatigue loop',
  code_awareness_risk: 'Code awareness gap',
  design_erosion_risk: 'Design erosion',
  time_context_risk: 'Time-context mismatch',
}

function statusTone(success: boolean): string {
  return success ? 'green' : 'red'
}

function actionLabel(action: Output['action']): string {
  if (action === 'init') return 'Initialize PM system'
  if (action === 'status') return 'Check PM status'
  if (action === 'catchup') return 'Catch up with git diff'
  if (action === 'sync') return 'Sync PM log'
  return 'Record decision'
}

function compactRiskList(risks: string[] | undefined): string {
  if (!risks || risks.length === 0) return 'none'
  return risks.map(risk => RISK_LABELS[risk] ?? risk).join(', ')
}

function paceSummary(output: Output): string {
  const phaseTotals = output.phaseTotals
  if (!phaseTotals || phaseTotals.total <= 0) return 'pace unknown'

  const completion = (phaseTotals.complete / phaseTotals.total) * 100
  if (completion >= 80) return `fast finish lane (${phaseTotals.complete}/${phaseTotals.total})`
  if (completion >= 40) return `shipping lane (${phaseTotals.complete}/${phaseTotals.total})`
  return `bootstrap lane (${phaseTotals.complete}/${phaseTotals.total})`
}

export function userFacingName(): string {
  return 'PMTool'
}

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  const action = input.action ?? 'status'
  if (action === 'init') {
    return input.projectName
      ? `Initialize startup-fast PM for ${input.projectName}`
      : 'Initialize startup-fast PM'
  }
  if (action === 'status') return 'Check project pace and guardrails'
  if (action === 'catchup') return 'Check unsynced workspace drift'
  if (action === 'sync') return 'Sync PM status to progress log'

  const decisionType = input.decisionType ?? 'decision'
  const title = input.title?.trim()
  return title
    ? `Record ${decisionType}: ${title}`
    : `Record ${decisionType}`
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const risks = compactRiskList(output.riskSignals)
  const hasRisk = Boolean(output.riskSignals && output.riskSignals.length > 0)
  const weekly = output.weeklyBoard

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color={statusTone(output.success)}>
          PM startup-fast | {actionLabel(output.action)} | {output.success ? 'ok' : 'needs_fix'}
        </Text>
        <Text dimColor={true}>{output.summary}</Text>
        <Text dimColor={true}>Pace: {paceSummary(output)}</Text>
        {output.controlTotals ? (
          <Text dimColor={true}>
            Controls {output.controlTotals.checked}/{output.controlTotals.total} checked
          </Text>
        ) : null}
        {weekly ? (
          <Text dimColor={true}>
            Weekly {weekly.weekOf} | goals {weekly.goalsDone}/{weekly.goalsTotal} | blockers {weekly.blockersOpen} | release {weekly.releaseWindow}
          </Text>
        ) : null}
        <Text color={hasRisk ? 'yellow' : 'green'}>Risks: {risks}</Text>
      </Box>
    </MessageResponse>
  )
}
