/**
 * Hacker News Scraper Service
 *
 * Scrapes stories and comments from Hacker News and persists
 * them to the complaints table for later processing.
 */

import { HNClient, getHNClient } from './client.js';
import {
  type ScraperConfig,
  type ScrapedItem,
  type ScrapeStats,
  type CategoryScrapeResult,
  type ScrapeError,
  type HNApiItem,
  type HNCategory,
  DEFAULT_SCRAPER_CONFIG,
} from './types.js';
import {
  insertComplaints,
  getComplaintBySource,
  getSetting,
  startJobRun,
  completeJobRun,
  failJobRun,
  type NewComplaint,
} from '../database/index.js';

/**
 * HackerNewsScraper class handles scraping stories and comments from HN
 */
export class HackerNewsScraper {
  private client: HNClient;
  private config: ScraperConfig;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.client = getHNClient({
      requestDelay: config.requestDelay ?? DEFAULT_SCRAPER_CONFIG.requestDelay,
      maxRetries: config.maxRetries ?? DEFAULT_SCRAPER_CONFIG.maxRetries,
    });
    this.config = { ...DEFAULT_SCRAPER_CONFIG, ...config };
  }

  /**
   * Load config values from database settings
   */
  private async loadConfigFromSettings(): Promise<void> {
    try {
      const lookbackDays = await getSetting<number>('scrape_lookback_days');
      if (lookbackDays !== undefined && this.config.lookbackDays === DEFAULT_SCRAPER_CONFIG.lookbackDays) {
        this.config.lookbackDays = lookbackDays;
      }

      const maxItems = await getSetting<number>('max_items_per_category');
      if (maxItems !== undefined && this.config.maxItemsPerCategory === DEFAULT_SCRAPER_CONFIG.maxItemsPerCategory) {
        this.config.maxItemsPerCategory = maxItems;
      }
    } catch {
      console.warn('Could not load settings from database, using defaults');
    }
  }

  /**
   * Main entry point: scrape all configured categories
   */
  async scrapeCategories(categories?: HNCategory[]): Promise<ScrapeStats> {
    await this.loadConfigFromSettings();

    const jobRun = await startJobRun('scraper', {
      config: this.config,
      startTime: new Date().toISOString(),
    });

    const errors: ScrapeError[] = [];
    const stats: ScrapeStats = {
      totalFetched: 0,
      newItems: 0,
      duplicatesSkipped: 0,
      errorsEncountered: 0,
      categoryStats: {},
    };

    try {
      const targetCategories = categories || (await this.getMonitoredCategories());

      console.log(`Starting scrape of ${targetCategories.length} categories`);
      console.log(`Config: lookback=${this.config.lookbackDays} days, max=${this.config.maxItemsPerCategory} items/category`);

      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - this.config.lookbackDays);

      for (const category of targetCategories) {
        try {
          const result = await this.scrapeCategory(category, lookbackDate);

          stats.totalFetched += result.items.length;
          stats.categoryStats[category] = {
            stories: result.storiesCount,
            comments: result.commentsCount,
            errors: result.errors.length,
          };
          errors.push(...result.errors);

          const { newCount, skipCount } = await this.persistItems(result.items);
          stats.newItems += newCount;
          stats.duplicatesSkipped += skipCount;

          console.log(
            `  ${category}: ${result.storiesCount} stories, ${result.commentsCount} comments, ${newCount} new, ${skipCount} skipped`
          );
        } catch (error) {
          const scrapeError = this.createScrapeError(error, category);
          errors.push(scrapeError);
          stats.errorsEncountered++;
          console.error(`  ${category}: Error - ${scrapeError.message}`);
        }
      }

      await completeJobRun(jobRun.id, stats.newItems, {
        ...stats,
        endTime: new Date().toISOString(),
      });

      console.log(`\nScrape complete: ${stats.newItems} new items, ${stats.duplicatesSkipped} duplicates, ${stats.errorsEncountered} errors`);

      return stats;
    } catch (error) {
      const criticalError = this.createScrapeError(error);
      errors.push(criticalError);

      await failJobRun(
        jobRun.id,
        errors.map((e) => ({ message: e.message, stack: e.stack, timestamp: e.timestamp })),
        stats.newItems
      );

      throw error;
    }
  }

  /**
   * Scrape a single HN category for stories and comments
   */
  private async scrapeCategory(
    category: HNCategory,
    lookbackDate: Date
  ): Promise<CategoryScrapeResult> {
    const items: ScrapedItem[] = [];
    const errors: ScrapeError[] = [];
    let storiesCount = 0;
    let commentsCount = 0;

    try {
      // Get story IDs for the category
      const storyIds = await this.client.getStoryIds(category);
      const limitedStoryIds = storyIds.slice(0, this.config.maxItemsPerCategory);

      console.log(`  Fetching ${limitedStoryIds.length} stories from ${category}...`);

      for (const storyId of limitedStoryIds) {
        try {
          const story = await this.client.getItem(storyId);

          if (!story || story.deleted || story.dead) {
            continue;
          }

          // Check if story is within lookback window
          const storyDate = new Date(story.time * 1000);
          if (storyDate < lookbackDate) {
            continue;
          }

          // Extract story content
          const storyItem = this.extractStoryItem(story, category);
          if (storyItem) {
            items.push(storyItem);
            storiesCount++;
          }

          // Fetch comments if enabled
          if (this.config.fetchComments && story.kids && story.kids.length > 0) {
            try {
              const commentItems = await this.fetchStoryComments(story, category, lookbackDate);
              items.push(...commentItems);
              commentsCount += commentItems.length;
            } catch (error) {
              errors.push(this.createScrapeError(error, category, String(story.id)));
            }
          }
        } catch (error) {
          errors.push(this.createScrapeError(error, category, String(storyId)));
        }
      }
    } catch (error) {
      errors.push(this.createScrapeError(error, category));
    }

    return {
      category,
      items,
      storiesCount,
      commentsCount,
      errors,
    };
  }

  /**
   * Fetch top-level comments from a story
   */
  private async fetchStoryComments(
    story: HNApiItem,
    category: HNCategory,
    lookbackDate: Date
  ): Promise<ScrapedItem[]> {
    const items: ScrapedItem[] = [];

    if (!story.kids || story.kids.length === 0) {
      return items;
    }

    // Only fetch top-level comments, limited by config
    const commentIds = story.kids.slice(0, this.config.maxCommentsPerStory);

    for (const commentId of commentIds) {
      try {
        const comment = await this.client.getItem(commentId);

        if (!comment || comment.deleted || comment.dead || comment.type !== 'comment') {
          continue;
        }

        // Check if comment is within lookback window
        const commentDate = new Date(comment.time * 1000);
        if (commentDate < lookbackDate) {
          continue;
        }

        const commentItem = this.extractCommentItem(comment, category);
        if (commentItem) {
          items.push(commentItem);
        }
      } catch (error) {
        // Log but continue with other comments
        console.warn(`  Warning: Could not fetch comment ${commentId}: ${(error as Error).message}`);
      }
    }

    return items;
  }

  /**
   * Extract a ScrapedItem from an HN story
   */
  private extractStoryItem(story: HNApiItem, category: HNCategory): ScrapedItem | null {
    // Build text from title and body (text)
    const title = story.title?.trim() || '';
    const body = story.text ? this.stripHtml(story.text.trim()) : '';
    const text = body ? `${title}\n\n${body}` : title;

    // Skip if no meaningful text
    if (!text) {
      return null;
    }

    // Skip if no author
    if (!story.by) {
      return null;
    }

    return {
      sourceId: `hn_story_${story.id}`,
      sourceUrl: HNClient.getItemUrl(story.id),
      category,
      author: story.by,
      text,
      createdAt: new Date(story.time * 1000),
      type: 'story',
    };
  }

  /**
   * Extract a ScrapedItem from an HN comment
   */
  private extractCommentItem(comment: HNApiItem, category: HNCategory): ScrapedItem | null {
    const text = comment.text ? this.stripHtml(comment.text.trim()) : '';

    // Skip if no meaningful text
    if (!text) {
      return null;
    }

    // Skip if no author
    if (!comment.by) {
      return null;
    }

    return {
      sourceId: `hn_comment_${comment.id}`,
      sourceUrl: HNClient.getItemUrl(comment.id),
      category,
      author: comment.by,
      text,
      createdAt: new Date(comment.time * 1000),
      type: 'comment',
    };
  }

  /**
   * Strip HTML tags from text
   * HN stores comment text with HTML tags
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<p>/g, '\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/g, '$2 ($1)')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Persist scraped items to the database with deduplication
   */
  private async persistItems(items: ScrapedItem[]): Promise<{ newCount: number; skipCount: number }> {
    let newCount = 0;
    let skipCount = 0;

    const newItems: NewComplaint[] = [];

    for (const item of items) {
      const existing = await getComplaintBySource('hackernews', item.sourceId);
      if (existing) {
        skipCount++;
        continue;
      }

      newItems.push({
        sourcePlatform: 'hackernews',
        sourceId: item.sourceId,
        sourceUrl: item.sourceUrl,
        category: item.category,
        author: item.author,
        text: item.text,
        createdAt: item.createdAt,
      });
    }

    if (newItems.length > 0) {
      try {
        await insertComplaints(newItems);
        newCount = newItems.length;
      } catch {
        // Handle unique constraint violations - insert one by one
        for (const item of newItems) {
          try {
            await insertComplaints([item]);
            newCount++;
          } catch {
            skipCount++;
          }
        }
      }
    }

    return { newCount, skipCount };
  }

  /**
   * Get monitored categories from database settings
   */
  private async getMonitoredCategories(): Promise<HNCategory[]> {
    const categories = await getSetting<HNCategory[]>('monitored_categories');
    if (!categories || categories.length === 0) {
      throw new Error('No monitored categories configured. Run db:seed to initialize settings.');
    }
    return categories;
  }

  /**
   * Create a standardized error object
   */
  private createScrapeError(error: unknown, category?: string, itemId?: string): ScrapeError {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    return {
      message: errorObj.message,
      stack: errorObj.stack,
      timestamp: new Date().toISOString(),
      category,
      itemId,
    };
  }
}

/**
 * Scrape all configured categories using default configuration
 */
export async function scrapeAllCategories(config?: Partial<ScraperConfig>): Promise<ScrapeStats> {
  const scraper = new HackerNewsScraper(config);
  return scraper.scrapeCategories();
}

/**
 * Scrape specific categories
 */
export async function scrapeSpecificCategories(
  categories: HNCategory[],
  config?: Partial<ScraperConfig>
): Promise<ScrapeStats> {
  const scraper = new HackerNewsScraper(config);
  return scraper.scrapeCategories(categories);
}
