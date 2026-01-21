import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Parser from "rss-parser";

// Initialize RSS parser with browser-like headers to avoid access denied issues
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  },
  timeout: 15000
});

// The Verge RSS feed URLs by category
const VERGE_FEEDS = {
  all: "https://www.theverge.com/rss/index.xml",
  tech: "https://www.theverge.com/rss/tech/index.xml",
  science: "https://www.theverge.com/rss/science/index.xml",
  reviews: "https://www.theverge.com/rss/reviews/index.xml",
  entertainment: "https://www.theverge.com/rss/entertainment/index.xml",
} as const;

type FeedCategory = keyof typeof VERGE_FEEDS;

const RSS_SOURCE_NAME = "The Verge";

// Configuration schema - allows custom RSS URL
export const configSchema = z.object({
  customRssUrl: z.string().url().optional().describe("Custom RSS feed URL to use instead of The Verge"),
});

// Error types for better error handling
class FetchError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly url?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

class ParseError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ParseError';
  }
}

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; context?: string } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, context = 'operation' } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.error(`${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

// Helper function to fetch and parse RSS feed with retry logic
async function fetchNews(feedUrl: string): Promise<Parser.Item[]> {
  return withRetry(
    async () => {
      try {
        const feed = await parser.parseURL(feedUrl);
        return feed.items || [];
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Categorize the error for better user feedback
        if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('EAI_AGAIN')) {
          throw new FetchError(
            `DNS resolution failed - cannot reach the server. Check your internet connection.`,
            error instanceof Error ? error : undefined,
            feedUrl
          );
        }
        if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
          throw new FetchError(
            `Request timed out - the server took too long to respond.`,
            error instanceof Error ? error : undefined,
            feedUrl
          );
        }
        if (errorMessage.includes('ECONNREFUSED')) {
          throw new FetchError(
            `Connection refused - the server is not accepting connections.`,
            error instanceof Error ? error : undefined,
            feedUrl
          );
        }
        if (errorMessage.includes('403') || errorMessage.includes('Access denied')) {
          throw new FetchError(
            `Access denied - the server blocked the request. Try again later.`,
            error instanceof Error ? error : undefined,
            feedUrl,
            403
          );
        }
        if (errorMessage.includes('404')) {
          throw new FetchError(
            `Feed not found - the RSS feed URL may be incorrect.`,
            error instanceof Error ? error : undefined,
            feedUrl,
            404
          );
        }

        throw new FetchError(
          `Failed to fetch RSS feed: ${errorMessage}`,
          error instanceof Error ? error : undefined,
          feedUrl
        );
      }
    },
    { maxRetries: 3, baseDelayMs: 1000, context: `Fetching ${feedUrl}` }
  );
}

// Helper function to fetch article content by URL
async function fetchArticleContent(articleUrl: string): Promise<string> {
  return withRetry(
    async () => {
      try {
        const response = await fetch(articleUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        if (!response.ok) {
          throw new FetchError(
            `HTTP ${response.status}: ${response.statusText}`,
            undefined,
            articleUrl,
            response.status
          );
        }

        const html = await response.text();

        // Extract article content - simple extraction of text from common article tags
        // This is a basic implementation; a proper solution would use a library like @mozilla/readability
        const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
        const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        const contentMatch = html.match(/class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

        let content = articleMatch?.[1] || mainMatch?.[1] || contentMatch?.[1] || '';

        // Strip HTML tags and clean up
        content = content
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();

        if (!content || content.length < 100) {
          return `Could not extract article content. Please visit the URL directly: ${articleUrl}`;
        }

        // Limit content length
        if (content.length > 5000) {
          content = content.substring(0, 5000) + '...\n\n[Content truncated. Visit the full article for more.]';
        }

        return content;
      } catch (error) {
        if (error instanceof FetchError) throw error;

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new FetchError(
          `Failed to fetch article: ${errorMessage}`,
          error instanceof Error ? error : undefined,
          articleUrl
        );
      }
    },
    { maxRetries: 2, baseDelayMs: 1000, context: `Fetching article from ${articleUrl}` }
  );
}

// Helper function to format news items
function formatNewsItems(items: Parser.Item[]) {
  return items.map((item) => ({
    title: item.title || "No title",
    link: item.link || "#",
    pubDate: item.pubDate || "Unknown date",
    creator: item.creator || "Unknown author",
    content: item.contentSnippet || item.content || "No content available",
    categories: item.categories || [],
  }));
}

// Helper function to filter news by date
function filterNewsByDate(items: Parser.Item[], daysBack: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  return items.filter((item) => {
    if (!item.pubDate) return false;
    const pubDate = new Date(item.pubDate);
    return pubDate >= cutoffDate;
  });
}

// Helper function to filter news by keyword
function filterNewsByKeyword(items: Parser.Item[], keyword: string) {
  const lowerKeyword = keyword.toLowerCase();

  return items.filter((item) => {
    const title = (item.title || "").toLowerCase();
    const content = (item.contentSnippet || item.content || "").toLowerCase();
    return title.includes(lowerKeyword) || content.includes(lowerKeyword);
  });
}

// Helper function to format news as brief summaries
function formatNewsAsBriefSummary(items: ReturnType<typeof formatNewsItems>, limit: number = 10) {
  if (items.length === 0) {
    return "No news articles found for the specified criteria.";
  }

  const limitedItems = items.slice(0, limit);

  return limitedItems.map((item, index) => {
    const summary = item.content.substring(0, 150).trim() + (item.content.length > 150 ? "..." : "");

    return `
${index + 1}. ${item.title}
   Published: ${item.pubDate}
   Author: ${item.creator}
   Link: ${item.link}
   Summary: ${summary}
`;
  }).join("\n---\n");
}

// Helper function to randomly select news items
function getRandomNewsItems(items: Parser.Item[], count: number = 10) {
  if (items.length <= count) {
    return items;
  }

  const itemsCopy = [...items];
  const result: Parser.Item[] = [];

  for (let i = 0; i < count && itemsCopy.length > 0; i++) {
    const randomIndex = Math.floor(Math.random() * itemsCopy.length);
    result.push(itemsCopy[randomIndex]);
    itemsCopy.splice(randomIndex, 1);
  }

  return result;
}

// Format error for user display
function formatErrorMessage(error: unknown): string {
  if (error instanceof FetchError) {
    let msg = error.message;
    if (error.url) {
      msg += `\n   URL: ${error.url}`;
    }
    if (error.statusCode) {
      msg += `\n   Status: ${error.statusCode}`;
    }
    return msg;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// Main server creation function
export default function createServer({
  config,
}: {
  config: z.infer<typeof configSchema>;
}) {
  // Use custom RSS URL if provided, otherwise default to The Verge
  const customRssUrl = config.customRssUrl;

  const server = new McpServer({
    name: "verge-news",
    version: "1.0.0",
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  });

  // Tool: Get daily news with optional category filter
  server.tool(
    "get-daily-news",
    `Get the latest news from ${RSS_SOURCE_NAME} for today. Supports category filtering.`,
    {
      category: z.enum(["all", "tech", "science", "reviews", "entertainment"]).optional()
        .describe("News category to filter by (default: all)"),
      customUrl: z.string().url().optional()
        .describe("Custom RSS feed URL to fetch from instead of The Verge"),
    },
    async ({ category = "all", customUrl }: { category?: FeedCategory; customUrl?: string }) => {
      try {
        const feedUrl = customUrl || customRssUrl || VERGE_FEEDS[category];
        const sourceName = customUrl ? "Custom Feed" : (customRssUrl ? "Custom Feed" : `${RSS_SOURCE_NAME} (${category})`);

        const allNews = await fetchNews(feedUrl);
        const todayNews = filterNewsByDate(allNews, 1);
        const formattedNews = formatNewsItems(todayNews);
        const newsText = formatNewsAsBriefSummary(formattedNews, 10);

        return {
          content: [{
            type: "text",
            text: `# ${sourceName} - Today's News\n\n${newsText}`
          }]
        };
      } catch (error) {
        console.error("Error in get-daily-news:", error);
        return {
          content: [{
            type: "text",
            text: `Error fetching daily news:\n${formatErrorMessage(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool: Get weekly news with optional category filter
  server.tool(
    "get-weekly-news",
    `Get news from ${RSS_SOURCE_NAME} for the past week. Supports category filtering.`,
    {
      category: z.enum(["all", "tech", "science", "reviews", "entertainment"]).optional()
        .describe("News category to filter by (default: all)"),
      customUrl: z.string().url().optional()
        .describe("Custom RSS feed URL to fetch from instead of The Verge"),
    },
    async ({ category = "all", customUrl }: { category?: FeedCategory; customUrl?: string }) => {
      try {
        const feedUrl = customUrl || customRssUrl || VERGE_FEEDS[category];
        const sourceName = customUrl ? "Custom Feed" : (customRssUrl ? "Custom Feed" : `${RSS_SOURCE_NAME} (${category})`);

        const allNews = await fetchNews(feedUrl);
        const weeklyNews = filterNewsByDate(allNews, 7);
        const randomWeeklyNews = getRandomNewsItems(weeklyNews, 10);
        const formattedNews = formatNewsItems(randomWeeklyNews);
        const newsText = formatNewsAsBriefSummary(formattedNews);

        return {
          content: [{
            type: "text",
            text: `# ${sourceName} - Weekly News Highlights\n\n${newsText}`
          }]
        };
      } catch (error) {
        console.error("Error in get-weekly-news:", error);
        return {
          content: [{
            type: "text",
            text: `Error fetching weekly news:\n${formatErrorMessage(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool: Search news by keyword with optional category filter
  server.tool(
    "search-news",
    `Search for news articles from ${RSS_SOURCE_NAME} by keyword. Supports category filtering.`,
    {
      keyword: z.string().describe("Keyword to search for in news articles"),
      days: z.number().optional().describe("Number of days to look back (default: 30)"),
      category: z.enum(["all", "tech", "science", "reviews", "entertainment"]).optional()
        .describe("News category to filter by (default: all)"),
      customUrl: z.string().url().optional()
        .describe("Custom RSS feed URL to fetch from instead of The Verge"),
    },
    async ({ keyword, days = 30, category = "all", customUrl }: { keyword: string; days?: number; category?: FeedCategory; customUrl?: string }) => {
      try {
        const feedUrl = customUrl || customRssUrl || VERGE_FEEDS[category];
        const sourceName = customUrl ? "Custom Feed" : (customRssUrl ? "Custom Feed" : `${RSS_SOURCE_NAME} (${category})`);

        const allNews = await fetchNews(feedUrl);
        const filteredByDate = filterNewsByDate(allNews, days);
        const filteredByKeyword = filterNewsByKeyword(filteredByDate, keyword);
        const formattedNews = formatNewsItems(filteredByKeyword);
        const newsText = formatNewsAsBriefSummary(formattedNews, 10);

        return {
          content: [{
            type: "text",
            text: `# ${sourceName} - Search Results for "${keyword}"\n\nFound ${filteredByKeyword.length} articles matching "${keyword}" in the last ${days} days.\n\n${newsText}`
          }]
        };
      } catch (error) {
        console.error("Error in search-news:", error);
        return {
          content: [{
            type: "text",
            text: `Error searching news:\n${formatErrorMessage(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool: Get full article content by URL
  server.tool(
    "get-article",
    "Fetch the full content of a news article by its URL",
    {
      url: z.string().url().describe("The URL of the article to fetch"),
    },
    async ({ url }: { url: string }) => {
      try {
        const content = await fetchArticleContent(url);

        return {
          content: [{
            type: "text",
            text: `# Article Content\n\nURL: ${url}\n\n---\n\n${content}`
          }]
        };
      } catch (error) {
        console.error("Error in get-article:", error);
        return {
          content: [{
            type: "text",
            text: `Error fetching article:\n${formatErrorMessage(error)}\n\nYou can try visiting the URL directly: ${url}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool: List available categories
  server.tool(
    "list-categories",
    `List available news categories for ${RSS_SOURCE_NAME}`,
    {},
    async () => {
      const categories = Object.keys(VERGE_FEEDS) as FeedCategory[];

      const categoryList = categories.map(cat => {
        return `- **${cat}**: ${VERGE_FEEDS[cat]}`;
      }).join('\n');

      return {
        content: [{
          type: "text",
          text: `# Available ${RSS_SOURCE_NAME} Categories\n\n${categoryList}\n\nUse the \`category\` parameter in other tools to filter by category.`
        }]
      };
    }
  );

  // Resource handler
  server.resource(
    "news-archive",
    "news://archive",
    async (uri: URL) => ({
      contents: [{
        uri: uri.href,
        text: "This would be an archive of news articles"
      }]
    })
  );

  // Prompt handler
  server.prompt(
    "news-summary",
    `Summarize news from ${RSS_SOURCE_NAME} for a specified period`,
    {
      days: z.string().optional().describe("Number of days to summarize (default: 7)"),
      category: z.string().optional().describe("Category to summarize (default: all)"),
    },
    (args: { days?: string; category?: string }) => {
      const days = args.days ? parseInt(args.days, 10) : 7;
      const category = args.category || "all";

      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Please summarize the ${category} news from ${RSS_SOURCE_NAME} from the past ${days} days.`
          }
        }]
      };
    }
  );

  return server;
}

// Main function for local testing
async function main() {
  try {
    const server = createServer({ config: {} });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Verge News MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

// Run main if this file is executed directly
const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'));

if (isMainModule) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
