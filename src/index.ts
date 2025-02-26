import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Parser from "rss-parser";

// Initialize RSS parser
const parser = new Parser();
const VERGE_RSS_URL = "https://www.theverge.com/rss/index.xml";

// Create MCP server with all capabilities
const server = new McpServer({
  name: "verge-news",
  version: "1.0.0",
  capabilities: {
    tools: {},
    resources: {},
    prompts: {}
  }
});

// Helper function to fetch and parse RSS feed
async function fetchVergeNews() {
  try {
    const feed = await parser.parseURL(VERGE_RSS_URL);
    return feed.items;
  } catch (error) {
    console.error("Error fetching RSS feed:", error);
    throw new Error("Failed to fetch news from The Verge");
  }
}

// Helper function to format news items
function formatNewsItems(items: Parser.Item[]) {
  return items.map((item) => {
    return {
      title: item.title || "No title",
      link: item.link || "#",
      pubDate: item.pubDate || "Unknown date",
      creator: item.creator || "Unknown author",
      content: item.contentSnippet || item.content || "No content available",
    };
  });
}

// Helper function to filter news by date
function filterNewsByDate(items: Parser.Item[], daysBack: number) {
  const now = new Date();
  const cutoffDate = new Date(now.setDate(now.getDate() - daysBack));
  
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

// Helper function to format news as text
function formatNewsAsText(items: ReturnType<typeof formatNewsItems>) {
  if (items.length === 0) {
    return "No news articles found for the specified time period.";
  }
  
  return items.map((item, index) => {
    return `
${index + 1}. ${item.title}
   Published: ${item.pubDate}
   Author: ${item.creator}
   Link: ${item.link}
   
   ${item.content}
   `;
  }).join("\n---\n");
}

// Helper function to format news as brief summaries
function formatNewsAsBriefSummary(items: ReturnType<typeof formatNewsItems>, limit: number = 10) {
  if (items.length === 0) {
    return "No news articles found for the specified time period.";
  }
  
  // Limit the number of items
  const limitedItems = items.slice(0, limit);
  
  return limitedItems.map((item, index) => {
    // Extract a brief summary (first 150 characters)
    const summary = item.content.substring(0, 150).trim() + (item.content.length > 150 ? "..." : "");
    
    return `
${index + 1}. ${item.title}
   Link: ${item.link}
   Summary: ${summary}
   `;
  }).join("\n---\n");
}

// Helper function to randomly select news items
function getRandomNewsItems(items: Parser.Item[], count: number = 10) {
  if (items.length <= count) {
    return items; // Return all items if there are fewer than requested
  }
  
  // Create a copy of the array to avoid modifying the original
  const itemsCopy = [...items];
  const result: Parser.Item[] = [];
  
  // Randomly select 'count' items
  for (let i = 0; i < count; i++) {
    if (itemsCopy.length === 0) break;
    
    // Get a random index
    const randomIndex = Math.floor(Math.random() * itemsCopy.length);
    
    // Add the randomly selected item to the result
    result.push(itemsCopy[randomIndex]);
    
    // Remove the selected item to avoid duplicates
    itemsCopy.splice(randomIndex, 1);
  }
  
  return result;
}

// Main function to start the server
async function main() {
  try {
    // Register tool for daily news
    server.tool(
      "get-daily-news",
      "Get the latest news from The Verge for today",
      {},
      async () => {
        try {
          const allNews = await fetchVergeNews();
          const todayNews = filterNewsByDate(allNews, 1); // Last 24 hours
          const formattedNews = formatNewsItems(todayNews);
          const newsText = formatNewsAsBriefSummary(formattedNews, 10); // Limit to 10 items with brief summaries
          
          return {
            content: [
              {
                type: "text",
                text: `# The Verge - Today's News\n\n${newsText}`
              }
            ]
          };
        } catch (error) {
          console.error("Error in get-daily-news:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching daily news: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
    
    // Register tool for weekly news
    server.tool(
      "get-weekly-news",
      "Get the latest news from The Verge for the past week",
      {},
      async () => {
        try {
          const allNews = await fetchVergeNews();
          const weeklyNews = filterNewsByDate(allNews, 7); // Last 7 days
          
          // Randomly select 10 news items from the past week
          const randomWeeklyNews = getRandomNewsItems(weeklyNews, 10);
          
          const formattedNews = formatNewsItems(randomWeeklyNews);
          const newsText = formatNewsAsBriefSummary(formattedNews);
          
          return {
            content: [
              {
                type: "text",
                text: `# The Verge - Random Weekly News\n\n${newsText}`
              }
            ]
          };
        } catch (error) {
          console.error("Error in get-weekly-news:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching weekly news: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
    
    // Register tool for searching news by keyword
    server.tool(
      "search-news",
      "Search for news articles from The Verge by keyword",
      {
        keyword: z.string().describe("Keyword to search for in news articles"),
        days: z.number().optional().describe("Number of days to look back (default: 30)")
      },
      async ({ keyword, days = 30 }) => {
        try {
          const allNews = await fetchVergeNews();
          const filteredByDate = filterNewsByDate(allNews, days);
          const filteredByKeyword = filterNewsByKeyword(filteredByDate, keyword);
          const formattedNews = formatNewsItems(filteredByKeyword);
          const newsText = formatNewsAsBriefSummary(formattedNews, 10); // Use brief summary format with limit of 10
          
          return {
            content: [
              {
                type: "text",
                text: `# The Verge - Search Results for "${keyword}"\n\n${newsText}`
              }
            ]
          };
        } catch (error) {
          console.error("Error in search-news:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error searching news: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
    
    // Then implement resource handlers
    server.resource(
      "news-archive",
      "news://archive",
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: "This would be an archive of news articles"
        }]
      })
    );

    // And prompt handlers
    server.prompt(
      "news-summary",
      "Summarize news from The Verge for a specified period",
      {
        days: z.string().optional().describe("Number of days to summarize (default: 7)")
      },
      (args, extra) => {
        const days = args.days ? parseInt(args.days, 10) : 7;
        
        return {
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Please summarize the news from the past ${days} days.`
            }
          }]
        };
      }
    );
    
    // Connect to transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Verge News MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
}); 