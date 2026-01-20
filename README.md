# The Verge News MCP Server

An MCP server that provides tools to fetch and search news from The Verge's RSS feed.

<a href="https://glama.ai/mcp/servers/n6lbwdnbxa">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/n6lbwdnbxa/badge" alt="The Verge News Server MCP server" />
</a>

## Features

- Fetch today's news from The Verge
- Fetch a random selection of news from The Verge's past week
- Search for news articles by keyword

## Installation

```bash
# Clone the repository
git clone https://github.com/manimohans/verge-news-mcp.git
cd verge-news-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Running the server

```bash
npm start
```

### Using with Claude for Desktop

1. Install [Claude for Desktop](https://claude.ai/download)
2. Open your Claude for Desktop App configuration at:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the following configuration:

```json
{
  "mcpServers": {
    "verge-news": {
      "command": "node",
      "args": ["/absolute/path/to/verge-news-mcp/build/index.js"]
    }
  }
}
```

4. Restart Claude for Desktop


### Available Tools

#### get-daily-news

Fetches the latest news articles from The Verge published in the last 24 hours.

Example query: "What's in the news today from The Verge?"

#### get-weekly-news

Fetches news articles from The Verge published in the last 7 days.

Example query: "Show me The Verge's news from the past week."

**Note:** This tool randomly selects 10 news items from the past week, providing variety each time it's used.

#### search-news

Searches for news articles containing a specific keyword.

Parameters:
- `keyword`: The term to search for
- `days` (optional): Number of days to look back (default: 30)

Example query: "Find news articles about AI from The Verge."

## Development

```bash
# Run in development mode
npm run dev
```

## License

ISC
