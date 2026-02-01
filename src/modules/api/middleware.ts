import type { Request, Response, NextFunction } from 'express';
import { ApiError } from './types.js';

/**
 * Check if the request is for an API endpoint
 */
function isApiRequest(req: Request): boolean {
  return req.path.startsWith('/api/');
}

/**
 * Global error handling middleware.
 *
 * Catches all errors and returns proper HTTP responses with consistent format.
 * Returns JSON for API requests and renders error page for dashboard requests.
 * Logs errors to console (can be replaced with Winston or other logger).
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  console.error('[Error]', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    path: req.path,
    timestamp: new Date().toISOString(),
  });

  // Determine status code and message
  let statusCode = 500;
  let errorTitle = 'Internal Server Error';
  let errorMessage = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred'
    : err.message;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorTitle = err.error;
    errorMessage = err.message;
  } else if (err.name === 'ZodError') {
    statusCode = 400;
    errorTitle = 'Bad Request';
    errorMessage = 'Validation error: ' + err.message;
  }

  // Return JSON for API requests
  if (isApiRequest(req)) {
    res.status(statusCode).json({
      error: errorTitle,
      message: errorMessage,
    });
    return;
  }

  // Render error page for dashboard requests
  res.status(statusCode).render('error', {
    title: errorTitle,
    message: errorMessage,
  });
}

/**
 * 404 Not Found handler for undefined routes.
 * Returns JSON for API requests and renders error page for dashboard requests.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const message = `Route ${req.method} ${req.path} not found`;

  // Return JSON for API requests
  if (isApiRequest(req)) {
    res.status(404).json({
      error: 'Not Found',
      message,
    });
    return;
  }

  // Render error page for dashboard requests
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
  });
}

/**
 * Request logging middleware.
 */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
}
