/**
 * API Module
 *
 * Provides REST API endpoints for the Idea Getter dashboard.
 *
 * Endpoints:
 * - GET /api/opportunities - List opportunities above threshold
 * - GET /api/opportunities/:id - Get opportunity details
 * - POST /api/opportunities/:id/bookmark - Toggle bookmark status
 * - GET /api/settings - Get current settings
 * - PUT /api/settings - Update settings
 * - GET /api/status - Get system status
 */

import express, { Router } from 'express';
import cors from 'cors';
import opportunitiesRouter from './opportunities.js';
import settingsRouter from './settings.js';
import statusRouter from './status.js';
import { errorHandler, notFoundHandler, requestLogger } from './middleware.js';

// Export types
export * from './types.js';

// Export middleware
export { errorHandler, notFoundHandler, requestLogger } from './middleware.js';

/**
 * Creates the API router with all routes and middleware.
 */
export function createApiRouter(): Router {
  const router = Router();

  // Mount route handlers
  router.use('/opportunities', opportunitiesRouter);
  router.use('/settings', settingsRouter);
  router.use('/status', statusRouter);

  return router;
}

/**
 * Creates and configures the Express application with all middleware.
 *
 * @param options - Configuration options
 * @returns Configured Express application
 */
export function createApp(options: { enableCors?: boolean; enableLogging?: boolean } = {}): express.Application {
  const { enableCors = true, enableLogging = true } = options;

  const app = express();

  // Parse JSON request bodies
  app.use(express.json());

  // Enable CORS if requested
  if (enableCors) {
    app.use(cors());
  }

  // Request logging
  if (enableLogging) {
    app.use(requestLogger);
  }

  // Mount API routes
  app.use('/api', createApiRouter());

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

// Default export for convenience
export default createApp;
