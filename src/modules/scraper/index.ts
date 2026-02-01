/**
 * Hacker News Scraper Module
 *
 * Provides HN scraping functionality for the Idea Getter system.
 * Uses the public HN Firebase API (no authentication required).
 */

// Export types
export {
  type HNCategory,
  type ScraperConfig,
  type ScrapedItem,
  type ScrapeStats,
  type CategoryScrapeResult,
  type ScrapeError,
  type HNApiItem,
  DEFAULT_SCRAPER_CONFIG,
} from './types.js';

// Export client utilities
export { HNClient, getHNClient, resetHNClient, HN_WEB_BASE } from './client.js';

// Export scraper class and functions
export { HackerNewsScraper, scrapeAllCategories, scrapeSpecificCategories } from './scraper.js';
