/**
 * Dashboard Module
 *
 * Provides server-rendered views for the Idea Getter dashboard.
 *
 * Routes:
 * - GET / - Dashboard list view (opportunities)
 * - GET /opportunity/:id - Opportunity detail view
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getOpportunities,
  getOpportunityDetails,
  getSetting,
  getAllSettings,
  getSystemStats,
  getLatestJobRun,
} from '../database/index.js';

const router = Router();

/**
 * Helper to format relative time (e.g., "2 hours ago")
 */
function formatTimeAgo(date: Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

/**
 * Check if the last update is stale (>24 hours)
 */
function isStale(date: Date | null): boolean {
  if (!date) return true;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > 24;
}

/**
 * Format HN category names for display
 */
function formatCategory(category: string): string {
  const categoryMap: Record<string, string> = {
    ask: 'Ask HN',
    show: 'Show HN',
    top: 'Top Stories',
    new: 'New',
    best: 'Best',
  };
  return categoryMap[category.toLowerCase()] || category;
}

/**
 * GET /
 *
 * Dashboard list view showing all opportunities above threshold.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get sort params from query string
    const sort = (req.query.sort as string) || 'score';
    const order = (req.query.order as string) || 'desc';

    // Get minimum score threshold from settings
    const minScoreThreshold = (await getSetting<number>('min_score_threshold')) ?? 70;
    const minComplaintCount = (await getSetting<number>('min_complaint_count')) ?? 10;

    // Get all settings for the settings modal
    const settingsList = await getAllSettings();
    const settings: Record<string, unknown> = {};
    for (const setting of settingsList) {
      settings[setting.key] = setting.value;
    }

    // Get system stats for status bar
    const stats = await getSystemStats();
    const latestScraperRun = await getLatestJobRun('scraper');
    const lastUpdated = latestScraperRun?.runCompletedAt ?? null;

    // Map sort field to database column
    const sortBy = sort === 'score' ? 'score' : 'createdAt';

    // Fetch opportunities
    const opportunitiesList = await getOpportunities(minScoreThreshold, {
      sortBy,
      sortOrder: order as 'asc' | 'desc',
    });

    // Transform to view format
    const opportunities = [];

    for (const opp of opportunitiesList) {
      const details = await getOpportunityDetails(opp.id);
      if (!details) continue;

      const { cluster, quotes } = details;

      // Check minimum complaint count
      if (cluster.complaintCount < minComplaintCount) continue;

      // Find representative quote
      let representativeQuote = null;
      if (opp.representativeQuoteId) {
        const quote = quotes.find((q) => q.id === opp.representativeQuoteId);
        if (quote) {
          representativeQuote = {
            text: quote.text,
            author: quote.author,
            sourceUrl: quote.sourceUrl,
            category: formatCategory(quote.category),
          };
        }
      } else if (quotes.length > 0) {
        representativeQuote = {
          text: quotes[0].text,
          author: quotes[0].author,
          sourceUrl: quotes[0].sourceUrl,
          category: formatCategory(quotes[0].category),
        };
      }

      // Format platforms for display
      const platforms = Object.keys(cluster.platformDistribution).map(formatCategory);

      opportunities.push({
        id: opp.id,
        summary: cluster.summary,
        score: opp.score,
        complaintCount: cluster.complaintCount,
        platforms,
        platformsDisplay: platforms.join(', '),
        representativeQuote,
        isBookmarked: opp.isBookmarked,
        firstSeen: formatTimeAgo(cluster.firstSeen),
      });
    }

    // Sort by count if requested
    if (sort === 'count') {
      opportunities.sort((a, b) => {
        const diff = a.complaintCount - b.complaintCount;
        return order === 'desc' ? -diff : diff;
      });
    }

    // Render the dashboard
    res.render('opportunities', {
      title: 'Idea Getter',
      opportunities,
      sort,
      order,
      stats: {
        lastUpdated: formatTimeAgo(lastUpdated),
        lastUpdatedStale: isStale(lastUpdated),
        complaintsAnalyzed: stats.totalComplaints,
        opportunitiesFound: opportunities.length,
        clustersFormed: stats.totalClusters,
      },
      settings: {
        minScoreThreshold: settings.min_score_threshold ?? 70,
        minComplaintCount: settings.min_complaint_count ?? 10,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /opportunity/:id
 *
 * Opportunity detail view showing full evidence and analysis.
 */
router.get('/opportunity/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    // Fetch opportunity details
    const details = await getOpportunityDetails(id);
    if (!details) {
      res.status(404).render('error', {
        title: 'Not Found',
        message: 'Opportunity not found',
      });
      return;
    }

    const { opportunity, cluster, quotes } = details;

    // Get settings for the modal
    const settingsList = await getAllSettings();
    const settings: Record<string, unknown> = {};
    for (const setting of settingsList) {
      settings[setting.key] = setting.value;
    }

    // Get system stats for status bar
    const stats = await getSystemStats();
    const latestScraperRun = await getLatestJobRun('scraper');
    const lastUpdated = latestScraperRun?.runCompletedAt ?? null;

    // Format platform distribution for display
    const platformBreakdown = Object.entries(cluster.platformDistribution).map(
      ([category, count]) => ({
        name: formatCategory(category),
        count: count as number,
      })
    );

    // Format quotes for display
    const formattedQuotes = quotes.map((quote, index) => ({
      text: quote.text,
      author: quote.author,
      date: formatTimeAgo(quote.createdAt),
      category: formatCategory(quote.category),
      sourceUrl: quote.sourceUrl,
      similarity: Number((1.0 - index * 0.01).toFixed(2)),
    }));

    // Render the detail page
    res.render('detail', {
      title: `${cluster.summary.substring(0, 50)}... - Idea Getter`,
      opportunity: {
        id: opportunity.id,
        summary: cluster.summary,
        score: opportunity.score,
        isBookmarked: opportunity.isBookmarked,
        complaintCount: cluster.complaintCount,
        firstSeen: formatTimeAgo(cluster.firstSeen),
        lastSeen: formatTimeAgo(cluster.lastSeen),
      },
      platformBreakdown,
      quotes: formattedQuotes,
      stats: {
        lastUpdated: formatTimeAgo(lastUpdated),
        lastUpdatedStale: isStale(lastUpdated),
        complaintsAnalyzed: stats.totalComplaints,
        opportunitiesFound: stats.totalOpportunities,
      },
      settings: {
        minScoreThreshold: settings.min_score_threshold ?? 70,
        minComplaintCount: settings.min_complaint_count ?? 10,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
export { router as dashboardRouter };
