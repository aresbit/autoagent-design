import { GlobTool } from './src/tools/GlobTool/GlobTool.js';

console.log('GlobTool:', GlobTool);
console.log('Type:', typeof GlobTool);
console.log('Name:', GlobTool.name);
console.log('Has call?', 'call' in GlobTool);
console.log('Has prompt?', 'prompt' in GlobTool);
console.log('prompt type:', typeof GlobTool.prompt);

if (GlobTool.prompt) {
  try {
    const result = GlobTool.prompt({});
    console.log('prompt call result:', result);
  } catch (err) {
    console.log('prompt call error:', err.message);
  }
}

// Check if tool can be built
try {
  const tool = GlobTool;
  console.log('Tool built successfully');
} catch (err) {
  console.log('Tool build error:', err.message);
}