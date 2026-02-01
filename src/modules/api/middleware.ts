import type { Request, Response, NextFunction } from 'express';
import { ApiError, InternalServerError, type ErrorResponse } from './types.js';

/**
 * Global error handling middleware.
 *
 * Catches all errors and returns proper HTTP responses with consistent format.
 * Logs errors to console (can be replaced with Winston or other logger).
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  // Log the error
  console.error('[API Error]', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });

  // Handle known API errors
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Validation error: ' + err.message,
    });
    return;
  }

  // Handle unknown errors as 500 Internal Server Error
  const internalError = new InternalServerError(
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  );
  res.status(internalError.statusCode).json(internalError.toJSON());
}

/**
 * 404 Not Found handler for undefined routes.
 */
export function notFoundHandler(req: Request, res: Response<ErrorResponse>): void {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

/**
 * Request logging middleware.
 */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
}
