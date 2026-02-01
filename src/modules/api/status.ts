import { Router } from 'express';
import { getSystemStats, getLatestJobRun } from '../database/index.js';
import { getScheduler } from '../scheduler/index.js';
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

/**
 * POST /api/status/trigger-pipeline
 *
 * Manually triggers the daily pipeline execution.
 * Returns immediately with the run ID; pipeline runs in background.
 */
router.post(
  '/trigger-pipeline',
  asyncHandler(async (_req, res) => {
    const scheduler = getScheduler();
    const state = scheduler.getState();

    if (state.isPipelineRunning) {
      res.status(409).json({
        error: 'Pipeline is already running',
        currentRunId: state.currentRunId,
      });
      return;
    }

    // Trigger pipeline in background (don't await)
    scheduler.triggerManually().catch((err) => {
      console.error('Pipeline execution error:', err);
    });

    res.status(202).json({
      message: 'Pipeline triggered successfully',
      status: 'running',
    });
  })
);

export default router;
