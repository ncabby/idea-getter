/**
 * Hacker News API Client
 *
 * Provides a simple fetch-based client for the HN Firebase API.
 * No authentication required - the API is completely open.
 *
 * API Documentation: https://github.com/HackerNews/API
 */

import type { HNApiItem, HNCategory } from './types.js';

/**
 * HN Firebase API base URL
 */
const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';

/**
 * HN website base URL for generating source URLs
 */
export const HN_WEB_BASE = 'https://news.ycombinator.com';

/**
 * Map HN categories to their API endpoints
 */
const CATEGORY_ENDPOINTS: Record<HNCategory, string> = {
  ask: 'askstories',
  show: 'showstories',
  top: 'topstories',
  new: 'newstories',
};

/**
 * Configuration for the HN API client
 */
export interface HNClientConfig {
  /** Delay between requests in ms (default: 100) */
  requestDelay: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay: number;
}

const DEFAULT_CLIENT_CONFIG: HNClientConfig = {
  requestDelay: 100,
  maxRetries: 3,
  retryBaseDelay: 1000,
};

/**
 * HN API Client class
 * Handles fetching data from the Hacker News Firebase API
 */
export class HNClient {
  private config: HNClientConfig;
  private lastRequestTime: number = 0;

  constructor(config: Partial<HNClientConfig> = {}) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
  }

  /**
   * Rate limit requests by waiting between calls
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.config.requestDelay) {
      const waitTime = this.config.requestDelay - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch with retry logic and exponential backoff
   */
  private async fetchWithRetry<T>(
    url: string,
    attempt: number = 1
  ): Promise<T | null> {
    await this.rateLimit();

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      const isRetryable = this.isRetryableError(error);
      const hasRetriesLeft = attempt < this.config.maxRetries;

      if (isRetryable && hasRetriesLeft) {
        const delay = Math.pow(2, attempt - 1) * this.config.retryBaseDelay;
        console.log(`  Retrying ${url} after ${delay}ms (attempt ${attempt + 1}/${this.config.maxRetries})...`);
        await this.sleep(delay);
        return this.fetchWithRetry<T>(url, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('fetch failed')
    ) {
      return true;
    }

    // Server errors
    if (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Get story IDs for a category
   */
  async getStoryIds(category: HNCategory): Promise<number[]> {
    const endpoint = CATEGORY_ENDPOINTS[category];
    const url = `${HN_API_BASE}/${endpoint}.json`;

    const ids = await this.fetchWithRetry<number[]>(url);
    return ids || [];
  }

  /**
   * Get a single item by ID
   */
  async getItem(id: number): Promise<HNApiItem | null> {
    const url = `${HN_API_BASE}/item/${id}.json`;
    return this.fetchWithRetry<HNApiItem>(url);
  }

  /**
   * Get multiple items by IDs (with rate limiting)
   */
  async getItems(ids: number[]): Promise<HNApiItem[]> {
    const items: HNApiItem[] = [];

    for (const id of ids) {
      try {
        const item = await this.getItem(id);
        if (item && !item.deleted && !item.dead) {
          items.push(item);
        }
      } catch (error) {
        // Log but continue with other items
        console.warn(`  Warning: Failed to fetch item ${id}: ${(error as Error).message}`);
      }
    }

    return items;
  }

  /**
   * Generate HN web URL for an item
   */
  static getItemUrl(id: number): string {
    return `${HN_WEB_BASE}/item?id=${id}`;
  }
}

/**
 * Singleton HN client instance
 * Lazily initialized on first use
 */
let hnClient: HNClient | null = null;

/**
 * Get the shared HN client instance
 */
export function getHNClient(config?: Partial<HNClientConfig>): HNClient {
  if (!hnClient) {
    hnClient = new HNClient(config);
  }
  return hnClient;
}

/**
 * Reset the HN client (useful for testing)
 */
export function resetHNClient(): void {
  hnClient = null;
}
