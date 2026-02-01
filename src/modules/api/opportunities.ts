import { Router } from 'express';
import {
  getOpportunities,
  getOpportunityDetails,
  getSetting,
} from '../database/index.js';
import { db } from '../database/client.js';
import { opportunities } from '../database/schema.js';
import { eq } from 'drizzle-orm';
import {
  asyncHandler,
  opportunitiesQuerySchema,
  bookmarkBodySchema,
  BadRequestError,
  NotFoundError,
  type OpportunitiesListResponse,
  type OpportunityDetailResponse,
  type OpportunityListItem,
  type QuoteWithSimilarity,
} from './types.js';

const router = Router();

/**
 * GET /api/opportunities
 *
 * Lists all opportunities above the configured minimum score threshold.
 * Query params:
 *   - sort: 'score' | 'date' | 'count' (default: 'score')
 *   - order: 'asc' | 'desc' (default: 'desc')
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Validate query params
    const parseResult = opportunitiesQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new BadRequestError(parseResult.error.issues[0].message);
    }
    const { sort, order } = parseResult.data;

    // Get minimum score threshold from settings
    const minScoreThreshold = await getSetting<number>('min_score_threshold') ?? 70;

    // Map sort field to database column
    const sortBy = sort === 'score' ? 'score' : 'createdAt';

    // Fetch opportunities
    const opportunitiesList = await getOpportunities(minScoreThreshold, {
      sortBy,
      sortOrder: order,
    });

    // Transform to API response format
    const responseItems: OpportunityListItem[] = [];

    for (const opp of opportunitiesList) {
      // Get the full details to get cluster info and representative quote
      const details = await getOpportunityDetails(opp.id);
      if (!details) continue;

      const { cluster, quotes } = details;

      // Find representative quote
      let representativeQuote = null;
      if (opp.representativeQuoteId) {
        const quote = quotes.find(q => q.id === opp.representativeQuoteId);
        if (quote) {
          representativeQuote = {
            text: quote.text,
            author: quote.author,
            sourceUrl: quote.sourceUrl,
          };
        }
      } else if (quotes.length > 0) {
        // Fallback to first quote
        representativeQuote = {
          text: quotes[0].text,
          author: quotes[0].author,
          sourceUrl: quotes[0].sourceUrl,
        };
      }

      responseItems.push({
        id: opp.id,
        summary: cluster.summary,
        score: opp.score,
        complaintCount: cluster.complaintCount,
        platforms: Object.keys(cluster.platformDistribution),
        representativeQuote,
        isBookmarked: opp.isBookmarked,
        firstSeen: cluster.firstSeen.toISOString(),
        lastSeen: cluster.lastSeen.toISOString(),
      });
    }

    // Sort by count if requested (since the database query doesn't support this)
    if (sort === 'count') {
      responseItems.sort((a, b) => {
        const diff = a.complaintCount - b.complaintCount;
        return order === 'desc' ? -diff : diff;
      });
    }

    const response: OpportunitiesListResponse = {
      opportunities: responseItems,
    };

    res.json(response);
  })
);

/**
 * GET /api/opportunities/:id
 *
 * Gets detailed information for a specific opportunity.
 * Includes the opportunity, cluster info, and all related quotes.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const details = await getOpportunityDetails(id);
    if (!details) {
      throw new NotFoundError(`Opportunity with id '${id}' not found`);
    }

    const { opportunity, cluster, quotes } = details;

    // Find representative quote for response
    let representativeQuote = null;
    if (opportunity.representativeQuoteId) {
      const quote = quotes.find(q => q.id === opportunity.representativeQuoteId);
      if (quote) {
        representativeQuote = {
          text: quote.text,
          author: quote.author,
          sourceUrl: quote.sourceUrl,
        };
      }
    } else if (quotes.length > 0) {
      representativeQuote = {
        text: quotes[0].text,
        author: quotes[0].author,
        sourceUrl: quotes[0].sourceUrl,
      };
    }

    // Transform quotes to API format with similarity
    // Note: We don't have pre-calculated similarity, so we'll use 1.0 for now
    // In a real implementation, you'd calculate similarity against the centroid
    const quotesWithSimilarity: QuoteWithSimilarity[] = quotes.map((quote, index) => ({
      text: quote.text,
      author: quote.author,
      date: quote.createdAt.toISOString(),
      platform: quote.category,
      sourceUrl: quote.sourceUrl,
      // Assign decreasing similarity for ordering (first = highest)
      similarity: Number((1.0 - index * 0.01).toFixed(2)),
    }));

    const response: OpportunityDetailResponse = {
      opportunity: {
        id: opportunity.id,
        summary: cluster.summary,
        score: opportunity.score,
        complaintCount: cluster.complaintCount,
        platforms: Object.keys(cluster.platformDistribution),
        representativeQuote,
        isBookmarked: opportunity.isBookmarked,
        firstSeen: cluster.firstSeen.toISOString(),
        lastSeen: cluster.lastSeen.toISOString(),
      },
      cluster: {
        platformDistribution: cluster.platformDistribution,
      },
      quotes: quotesWithSimilarity,
    };

    res.json(response);
  })
);

/**
 * POST /api/opportunities/:id/bookmark
 *
 * Sets the bookmark status for an opportunity.
 * Request body: { isBookmarked: boolean }
 */
router.post(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Validate request body
    const parseResult = bookmarkBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new BadRequestError(parseResult.error.issues[0].message);
    }
    const { isBookmarked } = parseResult.data;

    // Update the bookmark status
    const [updated] = await db
      .update(opportunities)
      .set({
        isBookmarked,
        updatedAt: new Date(),
      })
      .where(eq(opportunities.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError(`Opportunity with id '${id}' not found`);
    }

    // Get full opportunity details for response
    const details = await getOpportunityDetails(id);
    if (!details) {
      throw new NotFoundError(`Opportunity with id '${id}' not found`);
    }

    const { cluster, quotes } = details;

    // Find representative quote
    let representativeQuote = null;
    if (updated.representativeQuoteId) {
      const quote = quotes.find(q => q.id === updated.representativeQuoteId);
      if (quote) {
        representativeQuote = {
          text: quote.text,
          author: quote.author,
          sourceUrl: quote.sourceUrl,
        };
      }
    } else if (quotes.length > 0) {
      representativeQuote = {
        text: quotes[0].text,
        author: quotes[0].author,
        sourceUrl: quotes[0].sourceUrl,
      };
    }

    const response: OpportunityListItem = {
      id: updated.id,
      summary: cluster.summary,
      score: updated.score,
      complaintCount: cluster.complaintCount,
      platforms: Object.keys(cluster.platformDistribution),
      representativeQuote,
      isBookmarked: updated.isBookmarked,
      firstSeen: cluster.firstSeen.toISOString(),
      lastSeen: cluster.lastSeen.toISOString(),
    };

    res.json(response);
  })
);

export default router;
