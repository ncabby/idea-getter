/**
 * Type definitions for the Intelligence Engine module
 */

import type { Complaint, Cluster, Opportunity } from '../database/index.js';

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Configuration for the Intelligence Engine
 */
export interface IntelligenceConfig {
  /** Similarity threshold for clustering (default: 0.75) */
  similarityThreshold: number;
  /** Minimum score for creating opportunities (default: 70) */
  minScoreThreshold: number;
  /** Batch size for embedding generation (default: 50) */
  embeddingBatchSize: number;
  /** Maximum retry attempts for API calls (default: 3) */
  maxRetries: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay: number;
}

/**
 * Default intelligence engine configuration
 */
export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  similarityThreshold: 0.75,
  minScoreThreshold: 70,
  embeddingBatchSize: 50,
  maxRetries: 3,
  retryBaseDelay: 1000,
};

// =============================================================================
// COMPLAINT DETECTION TYPES
// =============================================================================

/**
 * Pattern categories for complaint detection
 */
export interface DetectionPatterns {
  /** Patterns indicating frustration (e.g., "frustrated", "annoying") */
  frustration: RegExp[];
  /** Patterns indicating failures (e.g., "doesn't work", "broken") */
  failure: RegExp[];
  /** Patterns indicating problems (e.g., "no way to", "impossible to") */
  problem: RegExp[];
}

/**
 * Result of complaint detection for a single item
 */
export interface DetectionResult {
  complaintId: string;
  isComplaint: boolean;
  matchedPatterns: {
    frustration: string[];
    failure: string[];
    problem: string[];
  };
  confidence: number;
}

/**
 * Statistics from a detection run
 */
export interface DetectionStats {
  totalProcessed: number;
  complaintsDetected: number;
  nonComplaints: number;
  patternBreakdown: {
    frustration: number;
    failure: number;
    problem: number;
  };
}

// =============================================================================
// EMBEDDING GENERATION TYPES
// =============================================================================

/**
 * Result of embedding generation for a single complaint
 */
export interface EmbeddingResult {
  complaintId: string;
  success: boolean;
  embedding?: number[];
  error?: string;
}

/**
 * Statistics from an embedding generation run
 */
export interface EmbeddingStats {
  totalProcessed: number;
  successfulEmbeddings: number;
  failedEmbeddings: number;
  cachedEmbeddings: number;
  batchesProcessed: number;
  errors: Array<{ complaintId: string; message: string }>;
}

// =============================================================================
// CLUSTERING TYPES
// =============================================================================

/**
 * Result of clustering a single complaint
 */
export interface ClusteringResult {
  complaintId: string;
  clusterId: string;
  isNewCluster: boolean;
  similarity?: number;
}

/**
 * Statistics from a clustering run
 */
export interface ClusteringStats {
  totalProcessed: number;
  assignedToExisting: number;
  newClustersCreated: number;
  summariesGenerated: number;
  summaryGenerationFailed: number;
  errors: Array<{ complaintId: string; message: string }>;
}

/**
 * Cluster update data after adding complaints
 */
export interface ClusterUpdate {
  clusterId: string;
  newComplaintCount: number;
  newCentroid: number[];
  platformDistribution: Record<string, number>;
  lastSeen: Date;
}

// =============================================================================
// SCORING TYPES
// =============================================================================

/**
 * Scoring factors for an opportunity
 */
export interface ScoringFactors {
  complaintCount: number;
  daysActive: number;
  growthPercentage: number;
  workaroundCount: number;
  platformCount: number;
}

/**
 * Result of scoring a single cluster
 */
export interface ScoringResult {
  clusterId: string;
  score: number;
  factors: ScoringFactors;
  meetsThreshold: boolean;
  representativeQuoteId?: string;
}

/**
 * Statistics from a scoring run
 */
export interface ScoringStats {
  totalClustersScored: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  clustersBelowThreshold: number;
  averageScore: number;
  topScore: number;
}

// =============================================================================
// PIPELINE TYPES
// =============================================================================

/**
 * Result of running the full intelligence pipeline
 */
export interface PipelineResult {
  detection: DetectionStats;
  embedding: EmbeddingStats;
  clustering: ClusteringStats;
  scoring: ScoringStats;
  totalDuration: number;
  errors: Array<{ stage: string; message: string; details?: unknown }>;
}

/**
 * Options for running the pipeline
 */
export interface PipelineOptions {
  /** Only run detection stage */
  detectOnly?: boolean;
  /** Only run embedding generation stage */
  embedOnly?: boolean;
  /** Only run clustering stage */
  clusterOnly?: boolean;
  /** Only run scoring stage */
  scoreOnly?: boolean;
  /** Maximum complaints to process per stage (for testing) */
  limit?: number;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Error from the intelligence engine
 */
export interface IntelligenceError {
  stage: 'detection' | 'embedding' | 'clustering' | 'scoring';
  message: string;
  complaintId?: string;
  clusterId?: string;
  stack?: string;
  timestamp: string;
}

// =============================================================================
// RE-EXPORTS FOR CONVENIENCE
// =============================================================================

export type { Complaint, Cluster, Opportunity };
