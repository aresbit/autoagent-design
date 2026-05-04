import { agentCapabilities } from '../capabilities.js';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

// OpenCC (claude-js) is a reverse-engineered Claude Code CLI that runs on
// Bun and speaks the identical `--output-format stream-json` protocol.
// Tried in order: `opencc` → `claude-js` (npm package name). The bundled
// dist path is shipped under `packages/opencc/dist/cli.js` in dev and under
// Electron `resourcesPath/opencc-dist/cli.js` in packaged builds.
export const openccAgentDef = {
  id: 'opencc',
  name: 'OpenCC',
  bin: 'opencc',
  fallbackBins: ['claude-js'],
  versionArgs: ['--version'],
  helpArgs: ['--help'],
  capabilityFlags: {
    '--include-partial-messages': 'partialMessages',
    '--add-dir': 'addDir',
  },
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'sonnet', label: 'Sonnet (alias)' },
    { id: 'opus', label: 'Opus (alias)' },
    { id: 'haiku', label: 'Haiku (alias)' },
    { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
    { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
  ],
  buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}) => {
    const caps = agentCapabilities.get('opencc') || {};
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (caps.partialMessages) {
      args.push('--include-partial-messages');
    }
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    const dirs = (extraAllowedDirs || []).filter(
      (d) => typeof d === 'string' && d.length > 0,
    );
    if (dirs.length > 0 && caps.addDir !== false) {
      args.push('--add-dir', ...dirs);
    }
    args.push('--permission-mode', 'bypassPermissions');
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'claude-stream-json',
} satisfies RuntimeAgentDef;
