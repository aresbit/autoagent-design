import { registerBundledSkill } from '../bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'

const TOOL_ADD_GUIDE = `# Claude Tool Add Skill

Operational guide for adding a new built-in tool to Claude Code CLI without
breaking the tool execution contract.

## When to Use This Skill

Use this skill when you need to:
1. Create a new built-in tool for Claude Code
2. Understand the tool architecture and implementation patterns
3. Follow step-by-step instructions for tool development
4. Reference existing tool examples and best practices

## Tool Architecture Overview

Claude Code tools are defined in \`src/tools/\` directory. Each tool is a directory containing:
- \`ToolNameTool.ts\` - Main tool definition
- Optionally \`UI.tsx\` for custom rendering
- Optionally \`prompt.ts\` for tool-specific prompts

Tools are registered in \`src/tools.ts\` and become available via the tool system.

## Non-Negotiable Contract

Every built-in tool must satisfy the runtime contract used by \`buildTool()\`,
\`toolExecution.ts\`, UI rendering, and API schema generation.

If you skip any of the following, the tool is not finished:

1. Export the tool through \`buildTool({ ... })\`
2. Define \`inputSchema\`
3. Return tool results as \`{ data: ... }\`, not raw objects
4. Implement \`mapToolResultToToolResultBlockParam()\`
5. Register the tool in \`src/tools.ts\`
6. Run \`bun run build\`
7. Run at least one direct smoke test of the tool's \`call()\`

## Most Important Rule: \`canUseTool\` Is Not A Subtool Executor

Do not write code that treats \`canUseTool\` as a helper for directly running
another tool. In this codebase, \`canUseTool\` is part of the permission flow,
not a generic nested tool-runtime API.

Wrong pattern:

\`\`\`ts
const result = await canUseTool({
  name: 'WebFetch',
  input: { url: input.url },
})
\`\`\`

That shape is not the built-in tool execution protocol and will break at
runtime.

Correct approach:

1. If the behavior can be implemented directly, call local utilities or domain
   services from inside the tool.
2. If logic should be shared, extract reusable helpers under the relevant tool
   or service module and import those helpers.
3. Only use permission-specific hooks when you are actually integrating with
   the permission subsystem.

Concrete example:

- For a wiki-ingest tool, calling \`fetchContent()\` from
  \`src/tools/WebFetchTool/utils.ts\` is correct.
- Pretending to invoke \`WebFetch\`, \`Write\`, or \`MemoryTool\` through
  \`canUseTool\` is incorrect.

## Step-by-Step Tool Creation

### 1. Create Tool Directory

Create a new directory under \`src/tools/\` with your tool name (PascalCase + "Tool" suffix).
Example: \`src/tools/MyNewToolTool/\`

### 2. Define Tool Interface

Create \`MyNewToolTool.ts\` with the following structure:

\`\`\`typescript
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    // Define your input parameters here
    param1: z.string().describe('Description of param1'),
    param2: z.number().optional().describe('Description of param2'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    message: z.string().describe('Status message'),
    // Add additional output fields as needed
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const MyNewToolTool = buildTool({
  name: 'mynewtool',
  searchHint: 'brief description for search',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Clear description of what this tool does'
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
    return 'MyNewTool'
  },
  isConcurrencySafe() {
    return false // Set to true if tool can run concurrently
  },
  isReadOnly() {
    return false // Set to true if tool doesn't modify state
  },
  async call(input: Input, context) {
    // Implement tool logic here
    // Prefer direct helper/service calls over nested tool execution

    return {
      data: {
        success: true,
        message: 'Operation completed successfully',
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.success ? output.message : \`Failed: \${output.message}\`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
\`\`\`

### 3. Add Tool Registration

Edit \`src/tools.ts\` to import and register your tool:

1. Add import statement near other imports:
   \`\`\`typescript
   import { MyNewToolTool } from './tools/MyNewToolTool/MyNewToolTool.js'
   \`\`\`

2. Add tool to \`getAllBaseTools()\` function array:
   \`\`\`typescript
   export function getAllBaseTools(): Tools {
     return [
       // ... existing tools
       MyNewToolTool,
       // ... more tools
     ]
   }
   \`\`\`

### 4. Implement Tool Logic

The \`call()\` method is where your tool's functionality lives. Key considerations:

- **Permissions**: Check if your tool needs special permissions
- **Progress Reporting**: Use \`onProgress\` for long-running operations
- **Error Handling**: Return meaningful error messages
- **Composition**: Reuse local helpers and services, not fake nested tool calls
- **Return Shape**: Always return \`{ data: ... }\`
- **Result Mapping**: Always implement \`mapToolResultToToolResultBlockParam()\`

### 5. Add Custom UI (Optional)

If your tool needs custom rendering in the terminal, create \`UI.tsx\`:

\`\`\`tsx
import React from 'react'
import type { ToolResult } from '../../Tool.js'
import type { Output } from './MyNewToolTool.js'

export function renderToolResultMessage(result: ToolResult<Output>) {
  // Custom rendering logic
  return <Text>Custom result display</Text>
}
\`\`\`

## BuildTool Checklist

Use this checklist before considering a new tool done:

- \`name\` is stable and lowercase
- \`searchHint\` is short and useful
- \`inputSchema\` is strict and documented
- \`inputJSONSchema\` is present when the tool should surface cleanly in schema-based views
- \`outputSchema\` matches the actual \`data\` payload
- \`userFacingName()\` is set when default naming is too raw
- \`isConcurrencySafe()\` reflects reality
- \`isReadOnly()\` reflects reality
- \`toAutoClassifierInput()\` is implemented if the tool has security relevance
- \`mapToolResultToToolResultBlockParam()\` produces a concise human-readable result
- Optional UI hooks are wired when the default transcript rendering is not enough

## Best Practices

### Naming Conventions
- Tool directory: \`PascalCaseTool\` (e.g., \`MyNewToolTool\`)
- Tool name: \`lowercase-kebab-case\` (e.g., \`mynewtool\`)
- File naming: Match tool name (e.g., \`MyNewToolTool.ts\`)

### Input/Output Design
- Use Zod schemas for validation
- Provide clear descriptions for each parameter
- Design output that's useful for both humans and other tools
- Keep the top-level returned payload small and stable
- Put rich content in the schema, but still summarize it in \`mapToolResultToToolResultBlockParam()\`

### Security Considerations
- Validate all inputs
- Sanitize file paths and commands
- Respect permission system
- Do not bypass permission flows by inventing nested tool execution APIs

### Performance
- Keep \`maxResultSizeChars\` appropriate for your output
- Implement \`isConcurrencySafe()\` correctly
- Use progress reporting for long operations

## Example Tools

Study these existing tools for reference:

1. **AutoresearchTool** - Simple tool with agent integration
2. **BashTool** - Complex tool with security considerations
3. **FileEditTool** - File manipulation with custom UI
4. **SkillTool** - Tool that invokes other skills

Each demonstrates different patterns and best practices.

## Required Validation Before You Stop

Do not stop after writing files. You must validate.

Minimum validation:

1. \`bun run build\`
2. A direct smoke test of the tool's \`call()\`
3. Verify the result shape is \`{ data: ... }\`
4. Verify \`mapToolResultToToolResultBlockParam()\` produces a sane message
5. Verify the tool is registered and loadable from \`src/tools.ts\`

Recommended smoke test pattern:

\`\`\`bash
bun -e "import { MyNewToolTool } from './src/tools/MyNewToolTool/MyNewToolTool.ts'; const res = await MyNewToolTool.call({ param1: 'x' }, { abortController: new AbortController() }); console.log(JSON.stringify(res));"
\`\`\`

If the tool writes files, point it at a temp directory with an env var or
temporary path and assert the file actually appears.

## Required Final Output Format

When you use this skill to implement a tool, your final response must include
all of the following sections in a compact, engineering-style format:

1. **Implemented**
   - Which files were added or changed
   - What the tool now does
2. **Validated**
   - Whether \`bun run build\` passed
   - Whether a direct \`tool.call()\` smoke test was run
   - What exact behavior the smoke test proved
3. **Gaps**
   - Anything not validated
   - Any assumptions still baked into the tool
   - Any follow-up work still needed
4. **Contract Check**
   - Confirm the tool returns \`{ data: ... }\`
   - Confirm \`mapToolResultToToolResultBlockParam()\` exists
   - Confirm registration in \`src/tools.ts\`

If any of these sections would be empty, explicitly say \`none\`.

## Completion Gate

Do not claim the tool is done if any of the following are still unknown:

- Whether the code builds
- Whether the tool can be imported
- Whether the tool's \`call()\` path runs successfully for one realistic input
- Whether the tool result shape matches the execution pipeline

If blocked, say exactly what is blocked and stop there. Do not imply "done except maybe tests".

## Common Runtime Bugs To Prevent Up Front

1. Returning a raw object instead of \`{ data: ... }\`
2. Forgetting \`mapToolResultToToolResultBlockParam()\`
3. Forgetting tool registration in \`src/tools.ts\`
4. Declaring schema fields that do not match runtime output
5. Claiming a tool is concurrency-safe when it writes shared state
6. Treating \`canUseTool\` as a nested executor
7. Building UI helpers but never wiring them into the tool definition
8. Stopping after codegen without a build or smoke test

## Testing Your Tool

1. **Build the project**: \`bun run build\`
2. **Run in dev mode**: \`bun run dev\`
3. **Test tool invocation**: Use the tool in conversation
4. **Verify permissions**: Test with different permission modes
5. **Test tool.call directly**: Catch contract bugs before conversational testing

## Common Pitfalls

1. **Missing import in tools.ts** - Tool won't appear
2. **Incorrect Zod schema** - Validation errors
3. **Not handling errors** - Unclear failure messages
4. **Ignoring concurrency safety** - Potential race conditions
5. **Wrong return contract** - Tool execution pipeline breaks
6. **Wrong assumptions about \`canUseTool\`** - Runtime failures

## Next Steps

After creating your tool:
1. Test thoroughly
2. Document tool usage
3. Consider adding to tool presets if widely useful
4. Update CLAUDE.md if tool is significant addition

## Getting Help

If you encounter issues:
1. Review existing tool implementations
2. Check \`src/Tool.js\` for base tool interface
3. Examine error messages in dev mode
4. Refer to Claude Code documentation

Remember: a good tool in this repo is not just "feature complete". It is
schema-correct, result-mapped, buildable, directly smoke-tested, and free of
invented tool-calling abstractions.
`

export function registerClaudeToolAddSkill(): void {
  registerBundledSkill({
    name: 'claude-tool-add-skill',
    description: 'Operational guide for adding new built-in tools to Claude Code CLI with the correct tool contract, validation steps, and completion gate. Use when: (1) Creating a new tool for Claude Code, (2) Understanding tool architecture and implementation patterns, (3) Following step-by-step instructions for tool development, (4) Referencing existing tool examples and best practices.',
    aliases: ['tool-add', 'add-tool', 'create-tool'],
    argumentHint: '[topic] - Optional topic to focus on (e.g., "ui", "permissions", "testing")',
    userInvocable: true,
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit'],
    async getPromptForCommand(args: string, context: ToolUseContext) {
      let prompt = TOOL_ADD_GUIDE

      if (args.trim()) {
        const topic = args.trim().toLowerCase()
        prompt += `\n\n## Focus Topic: ${args.trim()}\n`

        if (topic.includes('ui') || topic.includes('render')) {
          prompt += `\n### Custom UI Development\n\nFor custom UI components, study:\n1. \`src/tools/FileEditTool/UI.tsx\` - Custom editor interface\n2. \`src/tools/BashTool/UI.tsx\` - Command output rendering\n3. \`src/ink/\` - Ink framework components\n\nKey patterns:\n- Use React components with Ink\n- Implement \`renderToolResultMessage\` function\n- Style with Ink's \`<Text>\` component\n- Handle different result states (success, error, progress)`
        }

        if (topic.includes('permission') || topic.includes('security')) {
          prompt += `\n### Permissions and Security\n\nSecurity considerations:\n1. Validate all user inputs\n2. Sanitize file paths and commands\n3. Respect the permission system\n4. Implement \`checkPermissions\` method if needed\n\nStudy \`src/tools/BashTool/\` for security patterns.`
        }

        if (topic.includes('test') || topic.includes('debug')) {
          prompt += `\n### Testing and Debugging\n\nTesting strategies:\n1. Manual testing in dev mode\n2. Build verification with \`bun run build\`\n3. Error handling testing\n4. Permission mode testing\n5. Direct \`tool.call()\` smoke tests\n\nUse \`Read\` and \`Grep\` tools to examine existing tool tests.`
        }

        if (topic.includes('schema') || topic.includes('zod')) {
          prompt += `\n### Schema Design\n\nZod schema best practices:\n1. Use \`lazySchema()\` for circular references\n2. Provide clear \`.describe()\` messages\n3. Validate input ranges and formats\n4. Define optional vs required fields clearly\n\nSee \`src/utils/lazySchema.js\` for implementation.`
        }
      }

      prompt += `\n\n## Execution Requirement\nIf you are asked to create or modify a tool, do not stop after code generation. Implement the tool, validate it, and report results using the Required Final Output Format above.`

      return [{ type: 'text', text: prompt }]
    },
  })
}
