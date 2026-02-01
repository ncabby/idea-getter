/**
 * Job Scheduler
 *
 * Manages scheduled execution of the daily pipeline using node-cron.
 *
 * Features:
 * - Runs daily at 2 AM UTC (configurable)
 * - Checks for missed runs on startup
 * - Prevents duplicate concurrent executions
 * - Graceful shutdown support
 */

import cron from 'node-cron';
import {
  getTodaysJobRuns,
  isJobRunning,
  getLatestJobRun,
} from '../database/index.js';
import { PipelineOrchestrator } from './orchestrator.js';
import {
  type SchedulerConfig,
  type SchedulerState,
  type DailyPipelineResult,
  DEFAULT_SCHEDULER_CONFIG,
} from './types.js';

/**
 * JobScheduler manages the cron-based execution of the daily pipeline
 */
export class JobScheduler {
  private config: SchedulerConfig;
  private cronJob: cron.ScheduledTask | null = null;
  private currentOrchestrator: PipelineOrchestrator | null = null;
  private state: SchedulerState;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.state = {
      isRunning: false,
      isPipelineRunning: false,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
    };
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('Scheduler is disabled');
      return;
    }

    if (this.state.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('\n--- Starting Job Scheduler ---');
    console.log(`Cron expression: ${this.config.cronExpression}`);
    console.log(`Timezone: ${this.config.timezone}`);
    console.log(`Pipeline timeout: ${this.config.pipelineTimeoutMs / 1000 / 60} minutes`);

    // Validate cron expression
    if (!cron.validate(this.config.cronExpression)) {
      throw new Error(`Invalid cron expression: ${this.config.cronExpression}`);
    }

    // Schedule the cron job
    this.cronJob = cron.schedule(
      this.config.cronExpression,
      async () => {
        console.log('\n[Scheduler] Cron triggered - starting daily pipeline');
        await this.executePipeline();
      },
      {
        timezone: this.config.timezone,
      }
    );

    this.state.isRunning = true;
    this.updateNextRunTime();

    console.log(`Next scheduled run: ${this.state.nextRunTime?.toISOString() ?? 'unknown'}`);

    // Check for missed runs on startup
    if (this.config.checkMissedRunsOnStartup) {
      await this.checkAndRunMissedJob();
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    console.log('\n--- Stopping Job Scheduler ---');

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    // Cancel any running pipeline
    if (this.currentOrchestrator) {
      console.log('Cancelling running pipeline...');
      this.currentOrchestrator.cancel();
      this.currentOrchestrator = null;
    }

    this.state.isRunning = false;
    this.state.isPipelineRunning = false;
    this.state.currentRunId = undefined;
    this.state.nextRunTime = undefined;

    console.log('Scheduler stopped');
  }

  /**
   * Check if today's job has run; if not, execute immediately
   */
  private async checkAndRunMissedJob(): Promise<void> {
    console.log('\nChecking for missed runs...');

    try {
      // Check if pipeline is already running
      const alreadyRunning = await isJobRunning('daily_pipeline');
      if (alreadyRunning) {
        console.log('A pipeline is already running, skipping missed run check');
        return;
      }

      // Check for today's completed runs
      const todaysRuns = await getTodaysJobRuns('daily_pipeline');
      const completedToday = todaysRuns.some(run => run.status === 'completed');

      if (completedToday) {
        console.log('Pipeline already ran successfully today, no action needed');
        return;
      }

      // Check if there's a running job from today (maybe from another instance)
      const runningToday = todaysRuns.some(run => run.status === 'running');
      if (runningToday) {
        console.log('A pipeline is currently running for today');
        return;
      }

      // No successful run today - execute immediately
      console.log('No successful run found for today - executing pipeline immediately');
      await this.executePipeline();
    } catch (error) {
      console.error('Error checking for missed runs:', error);
      // Don't throw - scheduler should continue even if check fails
    }
  }

  /**
   * Execute the pipeline with duplicate prevention
   */
  private async executePipeline(): Promise<DailyPipelineResult | null> {
    // Prevent duplicate executions
    if (this.state.isPipelineRunning) {
      console.log('[Scheduler] Pipeline already running, skipping');
      return null;
    }

    // Double-check with database
    const alreadyRunning = await isJobRunning('daily_pipeline');
    if (alreadyRunning) {
      console.log('[Scheduler] Pipeline running in another instance, skipping');
      return null;
    }

    this.state.isPipelineRunning = true;
    this.state.totalRuns++;

    try {
      this.currentOrchestrator = new PipelineOrchestrator({
        pipelineTimeoutMs: this.config.pipelineTimeoutMs,
      });

      const result = await this.currentOrchestrator.runPipeline();

      this.state.currentRunId = result.runId;
      this.state.lastRun = result;

      if (result.status === 'completed') {
        this.state.successfulRuns++;
      } else {
        this.state.failedRuns++;
      }

      return result;
    } catch (error) {
      console.error('[Scheduler] Pipeline execution error:', error);
      this.state.failedRuns++;
      return null;
    } finally {
      this.state.isPipelineRunning = false;
      this.state.currentRunId = undefined;
      this.currentOrchestrator = null;
      this.updateNextRunTime();
    }
  }

  /**
   * Calculate and update the next run time
   */
  private updateNextRunTime(): void {
    if (!this.cronJob) {
      this.state.nextRunTime = undefined;
      return;
    }

    // Parse cron expression to calculate next run
    // node-cron doesn't expose next run time directly, so we calculate it
    // For daily job at '0 2 * * *', we only need minute and hour
    const [minute, hour] = this.config.cronExpression.split(' ');

    const now = new Date();
    const next = new Date(now);

    // Set to the configured hour and minute
    next.setUTCHours(parseInt(hour, 10));
    next.setUTCMinutes(parseInt(minute, 10));
    next.setUTCSeconds(0);
    next.setUTCMilliseconds(0);

    // If the time has passed today, schedule for tomorrow
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    this.state.nextRunTime = next;
  }

  /**
   * Manually trigger the pipeline (for testing)
   */
  async triggerManually(): Promise<DailyPipelineResult | null> {
    console.log('\n[Scheduler] Manual trigger requested');
    return this.executePipeline();
  }

  /**
   * Get current scheduler state
   */
  getState(): SchedulerState {
    return { ...this.state };
  }

  /**
   * Get the latest job run information
   */
  async getLatestRun(): Promise<{
    runId?: string;
    status: string;
    startedAt?: Date;
    completedAt?: Date;
    itemsProcessed?: number;
  } | null> {
    const run = await getLatestJobRun('daily_pipeline');
    if (!run) return null;

    return {
      runId: run.id,
      status: run.status,
      startedAt: run.runStartedAt,
      completedAt: run.runCompletedAt ?? undefined,
      itemsProcessed: run.itemsProcessed,
    };
  }
}

// Singleton instance
let schedulerInstance: JobScheduler | null = null;

/**
 * Get or create the scheduler instance
 */
export function getScheduler(config?: Partial<SchedulerConfig>): JobScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new JobScheduler(config);
  }
  return schedulerInstance;
}

/**
 * Reset the scheduler instance (for testing)
 */
export function resetScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}

/**
 * Start the scheduler with default configuration
 */
export async function startScheduler(config?: Partial<SchedulerConfig>): Promise<JobScheduler> {
  const scheduler = getScheduler(config);
  await scheduler.start();
  return scheduler;
}

/**
 * Stop the scheduler
 */
export async function stopScheduler(): Promise<void> {
  if (schedulerInstance) {
    await schedulerInstance.stop();
  }
}
