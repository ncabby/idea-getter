import { Router } from 'express';
import { getSystemStats, getLatestJobRun } from '../database/index.js';
import { asyncHandler, type StatusResponse } from './types.js';

const router = Router();

/**
 * GET /api/status
 *
 * Returns system status information including:
 * - lastUpdated: Timestamp of the last scraper run
 * - complaintsAnalyzed: Total number of complaints in the database
 * - opportunitiesFound: Total number of opportunities found
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    // Get system statistics
    const stats = await getSystemStats();

    // Get the latest scraper job run for lastUpdated timestamp
    const latestScraperRun = await getLatestJobRun('scraper');

    const response: StatusResponse = {
      lastUpdated: latestScraperRun?.runCompletedAt?.toISOString() ?? null,
      complaintsAnalyzed: stats.totalComplaints,
      opportunitiesFound: stats.totalOpportunities,
    };

    res.json(response);
  })
);

export default router;
