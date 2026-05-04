export const PAPER2CODE_TOOL_NAME = 'paper2code'

export const DESCRIPTION = `Generate citation-anchored code implementations from arXiv papers.

This tool processes arXiv papers and generates complete, annotated code implementations with:
- Every line of code annotated with the exact paper section/equation it implements
- Ambiguity auditing to flag unspecified implementation choices
- Support for PyTorch, JAX, and TensorFlow
- Multiple output modes: minimal, full, educational

The output includes:
- README.md with paper summary and quick-start guide
- REPRODUCTION_NOTES.md with ambiguity audit and unspecified choices
- src/ directory with model, loss, training, and evaluation code
- configs/base.yaml with all hyperparameters (cited or flagged)
- notebooks/walkthrough.ipynb for pedagogical exploration

Key features:
- Citation anchoring: Code references paper sections (e.g., §3.2, Eq. 4)
- UNSPECIFIED flags: Marks choices not specified in the paper
- Official code linking: Checks for and references authors' implementations
- Appendix mining: Extracts critical details from appendices and footnotes`

export function getPrompt() {
  return DESCRIPTION
}
