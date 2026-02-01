import { Router } from 'express';
import { checkDatabaseHealth } from '../database/index.js';
import { asyncHandler, type HealthResponse } from './types.js';

const router = Router();

/**
 * GET /health
 *
 * Health check endpoint for AWS App Runner and load balancers.
 * Returns:
 * - 200 OK if database is reachable
 * - 503 Service Unavailable if database is down
 *
 * Response body:
 * {
 *   status: 'healthy' | 'unhealthy',
 *   database: 'connected' | 'disconnected'
 * }
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const isHealthy = await checkDatabaseHealth();

    const response: HealthResponse = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      database: isHealthy ? 'connected' : 'disconnected',
    };

    if (isHealthy) {
      res.status(200).json(response);
    } else {
      res.status(503).json(response);
    }
  })
);

export default router;
