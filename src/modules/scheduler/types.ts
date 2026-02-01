/**
 * Scheduler Module Types
 *
 * Type definitions for the job scheduler and pipeline orchestration.
 */

import type { ScrapeStats } from '../scraper/index.js';
import type { PipelineResult } from '../intelligence/index.js';

// =============================================================================
// SCHEDULER CONFIGURATION
// =============================================================================

/**
 * Scheduler configuration options
 */
export interface SchedulerConfig {
  /** Cron expression for daily run (default: '0 2 * * *' = 2 AM UTC) */
  cronExpression: string;
  /** Timezone for cron (default: 'UTC') */
  timezone: string;
  /** Whether to check for missed runs on startup (default: true) */
  checkMissedRunsOnStartup: boolean;
  /** Maximum pipeline execution time in milliseconds (default: 2 hours) */
  pipelineTimeoutMs: number;
  /** Whether to run the scheduler (default: true, can be disabled for testing) */
  enabled: boolean;
}

/**
 * Default scheduler configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  cronExpression: '0 2 * * *', // Daily at 2 AM UTC
  timezone: 'UTC',
  checkMissedRunsOnStartup: true,
  pipelineTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours
  enabled: true,
};

// =============================================================================
// CLEANUP SERVICE TYPES
// =============================================================================

/**
 * Cleanup configuration
 */
export interface CleanupConfig {
  /** Number of days to keep complaints (default: 30) */
  retentionDays: number;
}

/**
 * Default cleanup configuration
 */
export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  retentionDays: 30,
};

/**
 * Cleanup operation statistics
 */
export interface CleanupStats {
  /** Number of old complaints deleted */
  complaintsDeleted: number;
  /** Number of empty clusters deleted */
  clustersDeleted: number;
  /** Number of orphaned opportunities deleted */
  opportunitiesDeleted: number;
  /** Cutoff date used for cleanup */
  cutoffDate: Date;
  /** Duration of cleanup in milliseconds */
  durationMs: number;
  /** Any errors encountered during cleanup */
  errors: Array<{ operation: string; message: string }>;
}

// =============================================================================
// PIPELINE ORCHESTRATION TYPES
// =============================================================================

/**
 * Pipeline step names
 */
export type PipelineStep =
  | 'collection'
  | 'detection'
  | 'embedding'
  | 'clustering'
  | 'scoring'
  | 'cleanup';

/**
 * Status of a pipeline step
 */
export interface PipelineStepStatus {
  step: PipelineStep;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  stats?: unknown;
}

/**
 * Full daily pipeline execution result
 */
export interface DailyPipelineResult {
  /** Unique run ID */
  runId: string;
  /** Overall status */
  status: 'completed' | 'failed' | 'timeout';
  /** When the pipeline started */
  startedAt: Date;
  /** When the pipeline completed */
  completedAt: Date;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Individual step statuses */
  steps: Record<PipelineStep, PipelineStepStatus>;
  /** Scraper results */
  scrapeStats?: ScrapeStats;
  /** Intelligence pipeline results */
  intelligenceStats?: PipelineResult;
  /** Cleanup results */
  cleanupStats?: CleanupStats;
  /** Total items processed across all steps */
  totalItemsProcessed: number;
  /** Errors encountered */
  errors: Array<{
    step: PipelineStep;
    message: string;
    stack?: string;
    timestamp: string;
  }>;
}

// =============================================================================
// SCHEDULER STATE
// =============================================================================

/**
 * Current scheduler state
 */
export interface SchedulerState {
  /** Whether the scheduler is running */
  isRunning: boolean;
  /** Whether a pipeline is currently executing */
  isPipelineRunning: boolean;
  /** Current run ID if pipeline is running */
  currentRunId?: string;
  /** Last successful run result */
  lastRun?: DailyPipelineResult;
  /** Next scheduled run time */
  nextRunTime?: Date;
  /** Total runs since scheduler started */
  totalRuns: number;
  /** Successful runs since scheduler started */
  successfulRuns: number;
  /** Failed runs since scheduler started */
  failedRuns: number;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  ScrapeStats,
  PipelineResult,
};
