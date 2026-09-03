/**
 * NewsAPI Integration - Server-side only
 * Fetches recent news for debate context
 */

export interface NewsArticle {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  description: string;
}

export interface NewsResult {
  articles: NewsArticle[];
  query: string;
  totalResults: number;
  error?: string;
}

const NEWS_API_BASE = 'https://newsapi.org/v2';

/**
 * Fetch recent news for a ticker
 * @param ticker Stock ticker symbol
 * @param options Configuration options
 * @returns Normalized news articles
 */
export async function fetchNewsForTicker(
  ticker: string,
  options: { days?: number; limit?: number; companyName?: string } = {}
): Promise<NewsResult> {
  const { days = 14, limit = 8, companyName } = options;
  
  const apiKey = process.env.NEWS_API_KEY;
  
  if (!apiKey || apiKey.length < 20) {
    return {
      articles: [],
      query: ticker,
      totalResults: 0,
      error: 'NEWS_API_KEY not configured or invalid'
    };
  }
  
  // Build query: ticker + company name if available
  const query = companyName ? `${ticker} OR "${companyName}"` : ticker;
  
  // Calculate date range
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  
  const params = new URLSearchParams({
    q: query,
    from: fromDate.toISOString().split('T')[0],
    to: toDate.toISOString().split('T')[0],
    sortBy: 'publishedAt',
    language: 'en',
    pageSize: String(limit),
    apiKey: apiKey
  });
  
  try {
    const response = await fetch(`${NEWS_API_BASE}/everything?${params.toString()}`, {
      headers: {
        'User-Agent': 'RocketShip/1.0'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return {
        articles: [],
        query,
        totalResults: 0,
        error: `NewsAPI error ${response.status}: ${errorText.substring(0, 100)}`
      };
    }
    
    const data = await response.json();
    
    if (data.status !== 'ok') {
      return {
        articles: [],
        query,
        totalResults: 0,
        error: data.message || 'NewsAPI returned non-ok status'
      };
    }
    
    // Normalize articles
    const articles: NewsArticle[] = (data.articles || []).map((article: {
      title?: string;
      source?: { name?: string };
      publishedAt?: string;
      url?: string;
      description?: string;
    }) => ({
      title: article.title || 'No title',
      source: article.source?.name || 'Unknown',
      publishedAt: article.publishedAt || new Date().toISOString(),
      url: article.url || '',
      description: (article.description || '').substring(0, 500)
    }));
    
    return {
      articles,
      query,
      totalResults: data.totalResults || articles.length
    };
    
  } catch (error) {
    return {
      articles: [],
      query,
      totalResults: 0,
      error: error instanceof Error ? error.message : 'Unknown error fetching news'
    };
  }
}

/**
 * Test NewsAPI connectivity with minimal query
 */
export async function testNewsApiConnection(): Promise<{
  canReach: boolean;
  statusCode?: number;
  articleCount?: number;
  error?: string;
}> {
  const apiKey = process.env.NEWS_API_KEY;
  
  if (!apiKey || apiKey.length < 20) {
    return {
      canReach: false,
      error: 'NEWS_API_KEY not configured or invalid'
    };
  }
  
  try {
    const params = new URLSearchParams({
      q: 'AAPL',
      pageSize: '1',
      language: 'en',
      apiKey: apiKey
    });
    
    const response = await fetch(`${NEWS_API_BASE}/everything?${params.toString()}`, {
      headers: {
        'User-Agent': 'RocketShip/1.0'
      }
    });
    
    if (!response.ok) {
      return {
        canReach: false,
        statusCode: response.status,
        error: `HTTP ${response.status}`
      };
    }
    
    const data = await response.json();
    
    return {
      canReach: data.status === 'ok',
      statusCode: response.status,
      articleCount: data.totalResults || 0
    };
    
  } catch (error) {
    return {
      canReach: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
