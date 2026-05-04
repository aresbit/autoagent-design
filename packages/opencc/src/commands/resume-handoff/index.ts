import type { Command } from '../../commands.js'

const resumeHandoff: Command = {
  type: 'local-jsx',
  name: 'resume-handoff',
  description: 'Load a handoff markdown file and continue from it',
  argumentHint: '[path-to-handoff.md]',
  immediate: true,
  load: () => import('./resume-handoff.js'),
}

export default resumeHandoff
