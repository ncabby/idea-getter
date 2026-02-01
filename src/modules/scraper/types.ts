/**
 * Type definitions for the Hacker News Scraper module
 */

/**
 * Hacker News category types
 * - ask: Ask HN posts (questions from the community)
 * - show: Show HN posts (project showcases)
 * - top: Top stories
 * - new: Newest stories
 */
export type HNCategory = 'ask' | 'show' | 'top' | 'new';

/**
 * Configuration for the HN Scraper
 */
export interface ScraperConfig {
  /** Maximum items to fetch per category (default: 100) */
  maxItemsPerCategory: number;
  /** Days to look back for content (default: 30) */
  lookbackDays: number;
  /** Whether to fetch comments in addition to stories (default: true) */
  fetchComments: boolean;
  /** Maximum comments to fetch per story (default: 10) */
  maxCommentsPerStory: number;
  /** Maximum retry attempts for API errors (default: 3) */
  maxRetries: number;
  /** Delay between API requests in ms (default: 100) */
  requestDelay: number;
}

/**
 * Default scraper configuration
 */
export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  maxItemsPerCategory: 100,
  lookbackDays: 30,
  fetchComments: true,
  maxCommentsPerStory: 10,
  maxRetries: 3,
  requestDelay: 100,
};

/**
 * Raw scraped item from Hacker News before persistence
 */
export interface ScrapedItem {
  sourceId: string;
  sourceUrl: string;
  category: string;
  author: string;
  text: string;
  createdAt: Date;
  type: 'story' | 'comment';
}

/**
 * Statistics from a scraping run
 */
export interface ScrapeStats {
  totalFetched: number;
  newItems: number;
  duplicatesSkipped: number;
  errorsEncountered: number;
  categoryStats: Record<string, { stories: number; comments: number; errors: number }>;
}

/**
 * Result of a single category scrape
 */
export interface CategoryScrapeResult {
  category: string;
  items: ScrapedItem[];
  storiesCount: number;
  commentsCount: number;
  errors: Array<{ message: string; stack?: string; timestamp: string }>;
}

/**
 * Error that occurred during scraping
 */
export interface ScrapeError {
  message: string;
  stack?: string;
  timestamp: string;
  category?: string;
  itemId?: string;
}

/**
 * Raw HN API item response
 */
export interface HNApiItem {
  id: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time: number;
  text?: string;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}
