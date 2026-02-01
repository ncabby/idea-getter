/**
 * Pipeline Orchestrator
 *
 * Orchestrates the daily batch processing pipeline:
 * 1. Collection: Scrape HackerNews categories
 * 2. Detection: Detect complaints in scraped content
 * 3. Embedding: Generate vector embeddings
 * 4. Clustering: Group similar complaints
 * 5. Scoring: Score clusters as opportunities
 * 6. Cleanup: Archive old data
 *
 * Features:
 * - Sequential execution with error handling
 * - Timeout protection (default: 2 hours)
 * - Job tracking in system_metadata
 * - Graceful failure handling (continue on non-critical errors)
 */

import { scrapeAllCategories } from '../scraper/index.js';
import {
  detectComplaints,
  generateEmbeddings,
  clusterComplaints,
  scoreClusters,
} from '../intelligence/index.js';
import {
  startJobRun,
  completeJobRun,
  failJobRun,
  checkDatabaseHealth,
} from '../database/index.js';
import { CleanupService } from './cleanup.js';
import {
  type DailyPipelineResult,
  type PipelineStep,
  type PipelineStepStatus,
  type SchedulerConfig,
  DEFAULT_SCHEDULER_CONFIG,
} from './types.js';

/**
 * PipelineOrchestrator manages the full daily pipeline execution
 */
export class PipelineOrchestrator {
  private config: Pick<SchedulerConfig, 'pipelineTimeoutMs'>;
  private abortController: AbortController | null = null;

  constructor(config?: Partial<Pick<SchedulerConfig, 'pipelineTimeoutMs'>>) {
    this.config = {
      pipelineTimeoutMs: config?.pipelineTimeoutMs ?? DEFAULT_SCHEDULER_CONFIG.pipelineTimeoutMs,
    };
  }

  /**
   * Run the full daily pipeline
   */
  async runPipeline(): Promise<DailyPipelineResult> {
    const startedAt = new Date();
    this.abortController = new AbortController();

    // Initialize step statuses
    const steps: Record<PipelineStep, PipelineStepStatus> = {
      collection: { step: 'collection', status: 'pending' },
      detection: { step: 'detection', status: 'pending' },
      embedding: { step: 'embedding', status: 'pending' },
      clustering: { step: 'clustering', status: 'pending' },
      scoring: { step: 'scoring', status: 'pending' },
      cleanup: { step: 'cleanup', status: 'pending' },
    };

    const errors: DailyPipelineResult['errors'] = [];
    let totalItemsProcessed = 0;

    // Start job tracking
    const jobRun = await startJobRun('daily_pipeline', {
      startedAt: startedAt.toISOString(),
      config: this.config,
    });

    const result: DailyPipelineResult = {
      runId: jobRun.id,
      status: 'completed',
      startedAt,
      completedAt: new Date(),
      durationMs: 0,
      steps,
      totalItemsProcessed: 0,
      errors,
    };

    console.log('\n' + '='.repeat(60));
    console.log('DAILY PIPELINE STARTED');
    console.log(`Run ID: ${jobRun.id}`);
    console.log(`Started: ${startedAt.toISOString()}`);
    console.log('='.repeat(60) + '\n');

    try {
      // Run pipeline with timeout
      await this.runWithTimeout(async () => {
        // Pre-flight: Check database health
        const dbHealthy = await checkDatabaseHealth();
        if (!dbHealthy) {
          throw new Error('Database health check failed - aborting pipeline');
        }

        // Step 1: Collection (Scraper)
        await this.runStep('collection', steps, errors, async () => {
          const stats = await scrapeAllCategories();
          result.scrapeStats = stats;
          totalItemsProcessed += stats.newItems;
          return stats;
        });

        // Step 2: Detection
        await this.runStep('detection', steps, errors, async () => {
          const stats = await detectComplaints();
          totalItemsProcessed += stats.totalProcessed;
          return stats;
        });

        // Step 3: Embedding
        await this.runStep('embedding', steps, errors, async () => {
          const stats = await generateEmbeddings();
          totalItemsProcessed += stats.totalProcessed;
          return stats;
        });

        // Step 4: Clustering
        await this.runStep('clustering', steps, errors, async () => {
          const stats = await clusterComplaints();
          totalItemsProcessed += stats.totalProcessed;
          return stats;
        });

        // Step 5: Scoring
        await this.runStep('scoring', steps, errors, async () => {
          const stats = await scoreClusters();
          totalItemsProcessed += stats.totalClustersScored;
          return stats;
        });

        // Step 6: Cleanup
        await this.runStep('cleanup', steps, errors, async () => {
          const cleanupService = new CleanupService();
          const stats = await cleanupService.archiveOldData();
          result.cleanupStats = stats;
          return stats;
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      if (message.includes('Pipeline timeout')) {
        result.status = 'timeout';
        console.error('\nPIPELINE TIMEOUT');
      } else if (message.includes('Database health check failed')) {
        result.status = 'failed';
        errors.push({
          step: 'collection',
          message: 'Critical: Database connection lost',
          stack,
          timestamp: new Date().toISOString(),
        });
      } else {
        result.status = 'failed';
      }

      // Mark any pending steps as skipped
      for (const step of Object.values(steps)) {
        if (step.status === 'pending') {
          step.status = 'skipped';
        }
      }
    }

    // Finalize result
    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - startedAt.getTime();
    result.totalItemsProcessed = totalItemsProcessed;

    // Update job record
    if (result.status === 'completed') {
      await completeJobRun(jobRun.id, totalItemsProcessed, {
        steps: Object.fromEntries(
          Object.entries(steps).map(([k, v]) => [k, { status: v.status, stats: v.stats }])
        ),
        scrapeStats: result.scrapeStats,
        cleanupStats: result.cleanupStats,
        completedAt: result.completedAt.toISOString(),
        durationMs: result.durationMs,
      });
    } else {
      await failJobRun(
        jobRun.id,
        errors.map(e => ({
          message: e.message,
          stack: e.stack,
          timestamp: e.timestamp,
        })),
        totalItemsProcessed
      );
    }

    // Log summary
    console.log('\n' + '='.repeat(60));
    console.log(`DAILY PIPELINE ${result.status.toUpperCase()}`);
    console.log(`Duration: ${result.durationMs}ms`);
    console.log(`Items processed: ${totalItemsProcessed}`);
    console.log(`Errors: ${errors.length}`);
    console.log('='.repeat(60) + '\n');

    return result;
  }

  /**
   * Run a pipeline step with error handling
   */
  private async runStep(
    stepName: PipelineStep,
    steps: Record<PipelineStep, PipelineStepStatus>,
    errors: DailyPipelineResult['errors'],
    fn: () => Promise<unknown>
  ): Promise<void> {
    const step = steps[stepName];
    step.status = 'running';
    step.startedAt = new Date();

    console.log(`\n--- Step: ${stepName.toUpperCase()} ---`);

    try {
      const stats = await fn();
      step.status = 'completed';
      step.completedAt = new Date();
      step.stats = stats;
      console.log(`Step ${stepName} completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      step.status = 'failed';
      step.completedAt = new Date();
      step.error = message;

      errors.push({
        step: stepName,
        message,
        stack,
        timestamp: new Date().toISOString(),
      });

      console.error(`Step ${stepName} failed: ${message}`);

      // Continue with remaining steps (non-critical failure)
      // Only critical failures (db connection loss) should halt the pipeline
    }
  }

  /**
   * Run function with timeout
   */
  private async runWithTimeout(fn: () => Promise<void>): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Pipeline timeout after ${this.config.pipelineTimeoutMs}ms`));
      }, this.config.pipelineTimeoutMs);
    });

    await Promise.race([fn(), timeoutPromise]);
  }

  /**
   * Cancel the currently running pipeline
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

/**
 * Run the daily pipeline with default configuration
 */
export async function runDailyPipeline(
  config?: Partial<Pick<SchedulerConfig, 'pipelineTimeoutMs'>>
): Promise<DailyPipelineResult> {
  const orchestrator = new PipelineOrchestrator(config);
  return orchestrator.runPipeline();
}
