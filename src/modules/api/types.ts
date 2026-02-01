import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Query params for listing opportunities
 */
export const opportunitiesQuerySchema = z.object({
  sort: z.enum(['score', 'date', 'count']).optional().default('score'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type OpportunitiesQuery = z.infer<typeof opportunitiesQuerySchema>;

/**
 * Request body for toggling bookmark status
 */
export const bookmarkBodySchema = z.object({
  isBookmarked: z.boolean(),
});

export type BookmarkBody = z.infer<typeof bookmarkBodySchema>;

/**
 * Request body for updating settings
 */
export const updateSettingsBodySchema = z.object({
  min_score_threshold: z.number().min(0).max(100).optional(),
  min_complaint_count: z.number().min(1).optional(),
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Representative quote in opportunity list
 */
export interface RepresentativeQuote {
  text: string;
  author: string;
  sourceUrl: string;
}

/**
 * Opportunity in list response
 */
export interface OpportunityListItem {
  id: string;
  summary: string;
  score: number;
  complaintCount: number;
  platforms: string[];
  representativeQuote: RepresentativeQuote | null;
  isBookmarked: boolean;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Response for GET /api/opportunities
 */
export interface OpportunitiesListResponse {
  opportunities: OpportunityListItem[];
}

/**
 * Quote with similarity score for opportunity details
 */
export interface QuoteWithSimilarity {
  text: string;
  author: string;
  date: string;
  platform: string;
  sourceUrl: string;
  similarity: number;
}

/**
 * Cluster details for opportunity detail response
 */
export interface ClusterDetails {
  platformDistribution: Record<string, number>;
}

/**
 * Response for GET /api/opportunities/:id
 */
export interface OpportunityDetailResponse {
  opportunity: OpportunityListItem;
  cluster: ClusterDetails;
  quotes: QuoteWithSimilarity[];
}

/**
 * Response for GET /api/settings
 */
export interface SettingsResponse {
  [key: string]: unknown;
}

/**
 * Response for GET /api/status
 */
export interface StatusResponse {
  lastUpdated: string | null;
  complaintsAnalyzed: number;
  opportunitiesFound: number;
}

/**
 * Standard error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Base API error class
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly error: string;

  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
    this.name = 'ApiError';
  }

  toJSON(): ErrorResponse {
    return {
      error: this.error,
      message: this.message,
    };
  }
}

/**
 * 400 Bad Request error
 */
export class BadRequestError extends ApiError {
  constructor(message: string) {
    super(400, 'Bad Request', message);
    this.name = 'BadRequestError';
  }
}

/**
 * 404 Not Found error
 */
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, 'Not Found', message);
    this.name = 'NotFoundError';
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends ApiError {
  constructor(message: string = 'Internal server error') {
    super(500, 'Internal Server Error', message);
    this.name = 'InternalServerError';
  }
}

// =============================================================================
// TYPED REQUEST HANDLERS
// =============================================================================

/**
 * Typed async request handler with error handling
 */
export type AsyncRequestHandler<
  Params = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  Query = Record<string, unknown>
> = (
  req: Request<Params, ResBody, ReqBody, Query>,
  res: Response<ResBody>,
  next: NextFunction
) => Promise<void>;

/**
 * Wraps an async handler to catch errors and pass them to the error middleware
 */
export function asyncHandler<
  Params = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  Query = Record<string, unknown>
>(
  fn: AsyncRequestHandler<Params, ResBody, ReqBody, Query>
): (req: Request<Params, ResBody, ReqBody, Query>, res: Response<ResBody>, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
