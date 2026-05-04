import { registerBundledSkill } from '../bundledSkills.js'

const HANDOFF_PROMPT = `# Session Handoff Skill

Create structured handoff documents that preserve enough context to resume work
in a future session with minimal re-onboarding.

## When to Use

- Ending a work session for the day
- Before taking a break mid-task
- Switching to a different project temporarily
- Before an expected context reset
- Any time continuity across sessions matters

## Handoff Process

### 1. Assess Session State

Quickly determine:

1. What phase we are in (exploration, planning, implementation, debugging, review)
2. The active task
3. Progress so far (started, mid-way, almost done)

### 2. Ask What Matters Most

Ask the user:

"I'll create a handoff document. Is there anything specific you want to make
sure I capture? (Key decisions, code snippets, context about the problem,
things you'll forget, etc.)"

### 3. Generate the Handoff

Use this structure:

\`\`\`markdown
# Session Handoff: [Brief Description]

**Date:** [YYYY-MM-DD]
**Project:** [project name/path]
**Session Duration:** [approximate]

## Current State

**Task:** [what we're working on]
**Phase:** [exploration/planning/implementation/debugging/review]
**Progress:** [percentage or milestone]

## What We Did

[2-3 sentence summary]

## Decisions Made

- **[Decision]** - [Rationale]
- **[Decision]** - [Rationale]

## Code Changes

**Files modified:**
- \`path/to/file.ts\` - [what and why]
- \`path/to/other.ts\` - [what and why]

**Key code context:** [critical snippets or patterns to remember]

## Open Questions

- [ ] [Question needing resolution]
- [ ] [Question needing resolution]

## Blockers / Issues

- [Issue] - [current status]

## Context to Remember

[constraints, background, preferences, domain context]

## Next Steps

1. [ ] [First thing to do next session]
2. [ ] [Second thing]
3. [ ] [Third thing]

## Files to Review on Resume

- \`path/to/key/file.ts\` - [why it matters]
\`\`\`

### 4. Write the File

Default path:

\`.claude/handoffs/[YYYY-MM-DD]-[brief-description].md\`

Before writing, confirm with the user:

"I'll save this to \`.claude/handoffs/[filename].md\`. Want a different location?"

## What to Capture

### Always Include

1. Decisions with reasoning ("why", not only "what")
2. Code changes (paths + intent)
3. Current progress
4. Clear next steps
5. User context and constraints

### Include When Relevant

- Errors encountered and resolution status
- Dead ends that should not be repeated
- Key files to re-open first
- External dependencies and integration points

### Skip

- Verbose tool output
- Repetitive intermediate operations
- Generic statements that do not improve resumption speed

## Format Guidelines

- Use bullets for scannability
- Use concrete paths like \`src/foo.ts:42\`
- Use checkboxes (\`- [ ]\`) for action items
- Be specific and implementation-anchored

## Quality Check

Before finalizing, verify:

1. A fresh session could resume from this alone
2. Key decisions are traceable
3. Next steps are executable immediately
4. File references are sufficient to re-enter the code quickly

## Core Principle

Prioritize fast, accurate resumption over verbosity.
`

export function registerHandoffSkill(): void {
  registerBundledSkill({
    name: 'handoff',
    description:
      'Create a structured session handoff document for continuity across sessions.',
    whenToUse:
      'Use when ending a session, taking a break, switching contexts, or whenever the user needs reliable cross-session continuity.',
    argumentHint: '[specific details to preserve]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = HANDOFF_PROMPT

      if (args) {
        prompt += `\n## Additional context from user\n\n${args}\n`
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}
