/**
 * Scoring Engine Module
 *
 * Implements multi-factor scoring algorithm to evaluate clusters as opportunities.
 * Scores are based on persistence, growth, workaround density, and platform diversity.
 * Creates/updates opportunities for clusters meeting threshold criteria.
 */

import { db, pool } from '../database/client.js';
import { clusters, opportunities } from '../database/schema.js';
import {
  getActiveClusters,
  getComplaintsByCluster,
  upsertOpportunity,
  getSetting,
} from '../database/queries.js';
import { eq } from 'drizzle-orm';
import type { Cluster, Complaint } from '../database/schema.js';
import type { ScoringFactors, ScoringResult, ScoringStats } from './types.js';

// =============================================================================
// WORKAROUND PATTERNS
// =============================================================================

/**
 * Regex patterns to detect workaround mentions in complaints
 * Case-insensitive matching
 */
const WORKAROUND_PATTERNS = [
  /\bended up using\b/i,
  /\bmanually\b/i,
  /\bspreadsheet\b/i,
  /\bscript\b/i,
  /\bworkaround\b/i,
  /\bwork around\b/i,
  /\bDIY\b/i,
  /\bbuilt my own\b/i,
  /\bmade my own\b/i,
  /\bcreated my own\b/i,
  /\bhacked together\b/i,
  /\bwrote a script\b/i,
  /\bwrote my own\b/i,
  /\broll my own\b/i,
  /\brolled my own\b/i,
  /\bhad to build\b/i,
  /\bhad to create\b/i,
  /\bhad to make\b/i,
  /\bfor now i\b/i,
  /\bas a stopgap\b/i,
  /\btemporary fix\b/i,
  /\btemporary solution\b/i,
];

// =============================================================================
// SCORING ENGINE CLASS
// =============================================================================

/**
 * Configuration for the scoring engine
 */
export interface ScoringEngineConfig {
  /** Minimum score threshold for creating opportunities (default: 70) */
  minScoreThreshold: number;
  /** Scoring weights */
  weights: {
    complaintCount: number;
    daysActive: number;
    growthPercentage: number;
    workaroundCount: number;
    platformCount: number;
  };
}

const DEFAULT_SCORING_CONFIG: ScoringEngineConfig = {
  minScoreThreshold: 70,
  weights: {
    complaintCount: 2,
    daysActive: 1,
    growthPercentage: 0.5,
    workaroundCount: 5,
    platformCount: 3,
  },
};

/**
 * ScoringEngine evaluates clusters using a multi-factor algorithm.
 * Clusters meeting the score threshold become opportunities.
 */
export class ScoringEngine {
  private config: ScoringEngineConfig;

  constructor(config: Partial<ScoringEngineConfig> = {}) {
    this.config = {
      ...DEFAULT_SCORING_CONFIG,
      ...config,
      weights: {
        ...DEFAULT_SCORING_CONFIG.weights,
        ...config.weights,
      },
    };
  }

  /**
   * Count unique complaints mentioning workarounds
   */
  countWorkarounds(complaintsList: Complaint[]): number {
    let count = 0;

    for (const complaint of complaintsList) {
      const text = complaint.text.toLowerCase();
      const hasWorkaround = WORKAROUND_PATTERNS.some((pattern) =>
        pattern.test(text)
      );
      if (hasWorkaround) {
        count++;
      }
    }

    return count;
  }

  /**
   * Calculate days active (persistence)
   * days_active = (last_seen - first_seen) in days
   */
  calculateDaysActive(cluster: Cluster): number {
    const firstSeen = cluster.firstSeen.getTime();
    const lastSeen = cluster.lastSeen.getTime();
    const diffMs = lastSeen - firstSeen;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  /**
   * Calculate growth percentage
   * Compare last 14 days vs previous 14 days
   * growth_percentage = ((recent - previous) / previous) * 100
   * If previous period has 0 complaints, treat as 100% growth
   */
  async calculateGrowthPercentage(
    clusterComplaints: Complaint[]
  ): Promise<number> {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    // Count complaints in each period
    let recentCount = 0;
    let previousCount = 0;

    for (const complaint of clusterComplaints) {
      const createdAt = complaint.createdAt.getTime();

      if (createdAt >= fourteenDaysAgo.getTime()) {
        recentCount++;
      } else if (
        createdAt >= twentyEightDaysAgo.getTime() &&
        createdAt < fourteenDaysAgo.getTime()
      ) {
        previousCount++;
      }
    }

    // Calculate growth percentage
    if (previousCount === 0) {
      // If no previous complaints, treat as 100% growth (or recentCount * 10 for scaling)
      return recentCount > 0 ? 100 : 0;
    }

    return ((recentCount - previousCount) / previousCount) * 100;
  }

  /**
   * Calculate platform diversity
   * Count unique subreddits in platform distribution
   */
  calculatePlatformCount(cluster: Cluster): number {
    if (!cluster.platformDistribution) {
      return 0;
    }
    return Object.keys(cluster.platformDistribution).length;
  }

  /**
   * Find the representative quote (complaint with highest similarity to centroid)
   */
  async findRepresentativeQuote(
    cluster: Cluster,
    clusterComplaints: Complaint[]
  ): Promise<string | undefined> {
    if (clusterComplaints.length === 0 || !cluster.centroidEmbedding) {
      return undefined;
    }

    // Get complaint with embeddings
    const complaintsWithEmbeddings = clusterComplaints.filter((c) => c.embedding);
    if (complaintsWithEmbeddings.length === 0) {
      // Just return the first complaint if none have embeddings
      return clusterComplaints[0].id;
    }

    // Find complaint with highest similarity to centroid using pgvector
    const centroidStr = `[${cluster.centroidEmbedding.join(',')}]`;
    const complaintIds = complaintsWithEmbeddings.map((c) => c.id);

    const result = await pool.query<{ id: string; similarity: number }>(
      `SELECT id, 1 - (embedding <=> $1::vector) as similarity
       FROM complaints
       WHERE id = ANY($2)
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [centroidStr, complaintIds]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    return clusterComplaints[0].id;
  }

  /**
   * Calculate the total score for a cluster
   */
  calculateScore(factors: ScoringFactors): number {
    const { weights } = this.config;

    const rawScore =
      factors.complaintCount * weights.complaintCount +
      factors.daysActive * weights.daysActive +
      factors.growthPercentage * weights.growthPercentage +
      factors.workaroundCount * weights.workaroundCount +
      factors.platformCount * weights.platformCount;

    // Cap at 100
    return Math.min(100, Math.round(rawScore));
  }

  /**
   * Score a single cluster
   */
  async scoreCluster(cluster: Cluster): Promise<ScoringResult> {
    // Get all complaints in the cluster
    const clusterComplaints = await getComplaintsByCluster(cluster.id);

    // Calculate scoring factors
    const factors: ScoringFactors = {
      complaintCount: cluster.complaintCount,
      daysActive: this.calculateDaysActive(cluster),
      growthPercentage: await this.calculateGrowthPercentage(clusterComplaints),
      workaroundCount: this.countWorkarounds(clusterComplaints),
      platformCount: this.calculatePlatformCount(cluster),
    };

    // Calculate total score
    const score = this.calculateScore(factors);

    // Find representative quote
    const representativeQuoteId = await this.findRepresentativeQuote(
      cluster,
      clusterComplaints
    );

    return {
      clusterId: cluster.id,
      score,
      factors,
      meetsThreshold: score >= this.config.minScoreThreshold,
      representativeQuoteId,
    };
  }

  /**
   * Score all active clusters and create/update opportunities
   */
  async scoreAllClusters(minComplaintCount: number = 1): Promise<ScoringStats> {
    const stats: ScoringStats = {
      totalClustersScored: 0,
      opportunitiesCreated: 0,
      opportunitiesUpdated: 0,
      clustersBelowThreshold: 0,
      averageScore: 0,
      topScore: 0,
    };

    // Load threshold from settings if available
    const configuredThreshold = await getSetting<number>('min_score_threshold');
    const threshold = configuredThreshold ?? this.config.minScoreThreshold;

    // Get all active clusters
    const activeClusters = await getActiveClusters(minComplaintCount);

    if (activeClusters.length === 0) {
      return stats;
    }

    let totalScore = 0;

    for (const cluster of activeClusters) {
      const result = await this.scoreCluster(cluster);
      stats.totalClustersScored++;
      totalScore += result.score;

      if (result.score > stats.topScore) {
        stats.topScore = result.score;
      }

      // Check if meets threshold for opportunity
      if (result.score >= threshold) {
        // Check if opportunity already exists
        const existingOpportunity = await db
          .select()
          .from(opportunities)
          .where(eq(opportunities.clusterId, cluster.id))
          .limit(1);

        // Upsert opportunity
        await upsertOpportunity({
          clusterId: cluster.id,
          score: result.score,
          scoringFactors: result.factors,
          representativeQuoteId: result.representativeQuoteId,
        });

        if (existingOpportunity.length > 0) {
          stats.opportunitiesUpdated++;
        } else {
          stats.opportunitiesCreated++;
        }
      } else {
        stats.clustersBelowThreshold++;
      }
    }

    stats.averageScore = Math.round(totalScore / activeClusters.length);

    return stats;
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create an engine instance and score all clusters
 */
export async function scoreClusters(
  minComplaintCount?: number
): Promise<ScoringStats> {
  const engine = new ScoringEngine();
  return engine.scoreAllClusters(minComplaintCount);
}

/**
 * Score a specific cluster by ID
 */
export async function scoreClusterById(clusterId: string): Promise<ScoringResult> {
  const engine = new ScoringEngine();

  // Get the cluster
  const [cluster] = await db
    .select()
    .from(clusters)
    .where(eq(clusters.id, clusterId));

  if (!cluster) {
    throw new Error(`Cluster ${clusterId} not found`);
  }

  return engine.scoreCluster(cluster);
}
