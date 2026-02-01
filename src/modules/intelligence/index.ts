/**
 * Intelligence Engine Module
 *
 * Transforms raw scraped data into actionable opportunities through:
 * - Complaint Detection: Pattern matching for frustration language
 * - Embedding Generation: 1536-dim vectors via OpenAI
 * - Clustering: Semantic similarity grouping via pgvector
 * - Scoring: Multi-factor opportunity scoring
 */

import { startJobRun, completeJobRun, failJobRun } from '../database/queries.js';
import { detectComplaints } from './detector.js';
import { generateEmbeddings } from './embeddings.js';
import { clusterComplaints } from './clustering.js';
import { scoreClusters } from './scoring.js';
import type {
  PipelineResult,
  PipelineOptions,
  DetectionStats,
  EmbeddingStats,
  ClusteringStats,
  ScoringStats,
} from './types.js';

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export {
  // Configuration types
  type IntelligenceConfig,
  DEFAULT_INTELLIGENCE_CONFIG,
  // Detection types
  type DetectionPatterns,
  type DetectionResult,
  type DetectionStats,
  // Embedding types
  type EmbeddingResult,
  type EmbeddingStats,
  // Clustering types
  type ClusteringResult,
  type ClusteringStats,
  type ClusterUpdate,
  // Scoring types
  type ScoringFactors,
  type ScoringResult,
  type ScoringStats,
  // Pipeline types
  type PipelineResult,
  type PipelineOptions,
  type IntelligenceError,
} from './types.js';

// =============================================================================
// CLASS EXPORTS
// =============================================================================

export { ComplaintDetector, DEFAULT_DETECTION_PATTERNS } from './detector.js';
export {
  EmbeddingGenerator,
  resetOpenAIClient,
  type EmbeddingGeneratorConfig,
} from './embeddings.js';
export {
  ClusteringEngine,
  resetAnthropicClient,
  type ClusteringEngineConfig,
} from './clustering.js';
export { ScoringEngine, type ScoringEngineConfig } from './scoring.js';

// =============================================================================
// CONVENIENCE FUNCTION EXPORTS
// =============================================================================

export { detectComplaints } from './detector.js';
export { generateEmbeddings, generateSingleEmbedding } from './embeddings.js';
export { clusterComplaints } from './clustering.js';
export { scoreClusters, scoreClusterById } from './scoring.js';

// =============================================================================
// PIPELINE FUNCTIONS
// =============================================================================

/**
 * Run the full intelligence pipeline:
 * 1. Detect complaints -> Update is_complaint flag
 * 2. Generate embeddings -> Store in embedding column
 * 3. Cluster complaints -> Assign cluster_id, create/update clusters
 * 4. Score clusters -> Create/update opportunities
 */
export async function runIntelligencePipeline(
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  const errors: Array<{ stage: string; message: string; details?: unknown }> = [];

  const result: PipelineResult = {
    detection: {
      totalProcessed: 0,
      complaintsDetected: 0,
      nonComplaints: 0,
      patternBreakdown: { frustration: 0, failure: 0, problem: 0 },
    },
    embedding: {
      totalProcessed: 0,
      successfulEmbeddings: 0,
      failedEmbeddings: 0,
      cachedEmbeddings: 0,
      batchesProcessed: 0,
      errors: [],
    },
    clustering: {
      totalProcessed: 0,
      assignedToExisting: 0,
      newClustersCreated: 0,
      summariesGenerated: 0,
      summaryGenerationFailed: 0,
      errors: [],
    },
    scoring: {
      totalClustersScored: 0,
      opportunitiesCreated: 0,
      opportunitiesUpdated: 0,
      clustersBelowThreshold: 0,
      averageScore: 0,
      topScore: 0,
    },
    totalDuration: 0,
    errors,
  };

  // Start job run tracking
  const jobRun = await startJobRun('intelligence-pipeline', {
    options,
    startedAt: new Date().toISOString(),
  });

  try {
    // Stage 1: Detection
    if (!options.embedOnly && !options.clusterOnly && !options.scoreOnly) {
      console.log('Stage 1: Detecting complaints...');
      try {
        result.detection = await detectComplaints(options.limit);
        console.log(
          `  Detected ${result.detection.complaintsDetected} complaints out of ${result.detection.totalProcessed} items`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ stage: 'detection', message, details: error });
        console.error(`  Detection failed: ${message}`);
      }

      if (options.detectOnly) {
        result.totalDuration = Date.now() - startTime;
        await completeJobRun(jobRun.id, result.detection.totalProcessed, {
          result,
          stage: 'detection',
        });
        return result;
      }
    }

    // Stage 2: Embedding Generation
    if (!options.clusterOnly && !options.scoreOnly) {
      console.log('Stage 2: Generating embeddings...');
      try {
        result.embedding = await generateEmbeddings(options.limit);
        console.log(
          `  Generated ${result.embedding.successfulEmbeddings} embeddings (${result.embedding.failedEmbeddings} failed)`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ stage: 'embedding', message, details: error });
        console.error(`  Embedding generation failed: ${message}`);
      }

      if (options.embedOnly) {
        result.totalDuration = Date.now() - startTime;
        await completeJobRun(jobRun.id, result.embedding.totalProcessed, {
          result,
          stage: 'embedding',
        });
        return result;
      }
    }

    // Stage 3: Clustering
    if (!options.scoreOnly) {
      console.log('Stage 3: Clustering complaints...');
      try {
        result.clustering = await clusterComplaints(options.limit);
        console.log(
          `  Clustered ${result.clustering.totalProcessed} complaints (${result.clustering.newClustersCreated} new clusters)`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ stage: 'clustering', message, details: error });
        console.error(`  Clustering failed: ${message}`);
      }

      if (options.clusterOnly) {
        result.totalDuration = Date.now() - startTime;
        await completeJobRun(jobRun.id, result.clustering.totalProcessed, {
          result,
          stage: 'clustering',
        });
        return result;
      }
    }

    // Stage 4: Scoring
    console.log('Stage 4: Scoring clusters...');
    try {
      result.scoring = await scoreClusters();
      console.log(
        `  Scored ${result.scoring.totalClustersScored} clusters, created ${result.scoring.opportunitiesCreated} new opportunities`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ stage: 'scoring', message, details: error });
      console.error(`  Scoring failed: ${message}`);
    }

    result.totalDuration = Date.now() - startTime;

    // Complete job run
    const totalProcessed =
      result.detection.totalProcessed +
      result.embedding.totalProcessed +
      result.clustering.totalProcessed +
      result.scoring.totalClustersScored;

    await completeJobRun(jobRun.id, totalProcessed, { result });

    console.log(`\nPipeline completed in ${result.totalDuration}ms`);
    if (errors.length > 0) {
      console.log(`  ${errors.length} stage(s) had errors`);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    await failJobRun(
      jobRun.id,
      [{ message, stack, timestamp: new Date().toISOString() }],
      0
    );

    throw error;
  }
}

/**
 * Run only the detection stage
 */
export async function runDetection(limit?: number): Promise<DetectionStats> {
  const result = await runIntelligencePipeline({ detectOnly: true, limit });
  return result.detection;
}

/**
 * Run only the embedding stage
 */
export async function runEmbedding(limit?: number): Promise<EmbeddingStats> {
  const result = await runIntelligencePipeline({ embedOnly: true, limit });
  return result.embedding;
}

/**
 * Run only the clustering stage
 */
export async function runClustering(limit?: number): Promise<ClusteringStats> {
  const result = await runIntelligencePipeline({ clusterOnly: true, limit });
  return result.clustering;
}

/**
 * Run only the scoring stage
 */
export async function runScoring(): Promise<ScoringStats> {
  const result = await runIntelligencePipeline({ scoreOnly: true });
  return result.scoring;
}
