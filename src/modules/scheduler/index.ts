/**
 * Scheduler Module
 *
 * Provides job scheduling and pipeline orchestration for the Idea Getter system.
 * Runs the daily pipeline at 2 AM UTC:
 * 1. Collection: Scrape HackerNews
 * 2. Detection: Identify complaints
 * 3. Embedding: Generate vectors
 * 4. Clustering: Group similar complaints
 * 5. Scoring: Score opportunities
 * 6. Cleanup: Archive old data
 */

// Export types
export {
  type SchedulerConfig,
  type SchedulerState,
  type CleanupConfig,
  type CleanupStats,
  type PipelineStep,
  type PipelineStepStatus,
  type DailyPipelineResult,
  DEFAULT_SCHEDULER_CONFIG,
  DEFAULT_CLEANUP_CONFIG,
} from './types.js';

// Export cleanup service
export { CleanupService, runCleanup } from './cleanup.js';

// Export pipeline orchestrator
export { PipelineOrchestrator, runDailyPipeline } from './orchestrator.js';

// Export scheduler
export {
  JobScheduler,
  getScheduler,
  resetScheduler,
  startScheduler,
  stopScheduler,
} from './scheduler.js';
