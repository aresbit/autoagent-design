export const WIKI_TOOL_NAME = 'wikitool'

export const DESCRIPTION = `
- Fetches web content and saves it to personal wiki knowledge base at ~/yyswiki/raw_sources/
- Can save content as memory files for persistent knowledge storage
- Integrates with the LLM Wiki pattern for building personal knowledge bases
- Automatically organizes content by category (articles, papers, notes, images)
- Updates wiki logs and maintains file structure

## Usage

The WikiTool fetches content from URLs and saves it to your personal wiki knowledge base.
This enables the "LLM Wiki" pattern where fetched content becomes part of a growing,
organized knowledge repository rather than just temporary chat content.

## Workflow

1. **Fetch Content**: Uses WebFetchTool to retrieve and process web content
2. **Save to Wiki**: Saves cleaned markdown to ~/yyswiki/raw_sources/{category}/
3. **Save Memory**: Optionally creates memory file with metadata and summary
4. **Update Logs**: Adds entry to wiki/log.md for tracking

## Integration with LLM Wiki Pattern

This tool supports the three-layer LLM Wiki architecture:
- **Raw Sources**: Saves fetched content to ~/yyswiki/raw_sources/
- **Wiki Layer**: Content can be processed by LLM into structured wiki pages
- **Memory Layer**: Creates memory files for knowledge persistence

## Best Practices

- Use descriptive titles for better organization
- Add relevant tags for categorization
- Choose appropriate category (article, paper, note, image)
- Enable memory saving for important content that should persist

## Example Use Cases

- **Research**: Save academic papers and articles to build research knowledge base
- **Learning**: Save tutorials and documentation for future reference
- **Personal Notes**: Save important information to personal wiki
- **Content Curation**: Build collections of useful web resources
`
