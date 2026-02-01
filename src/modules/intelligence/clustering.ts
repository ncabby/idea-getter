/**
 * Clustering Engine Module
 *
 * Implements semantic similarity clustering using pgvector cosine similarity.
 * Assigns complaints to existing clusters or creates new ones based on
 * similarity threshold. Generates cluster summaries via Claude API.
 */

import Anthropic from '@anthropic-ai/sdk';
import { db } from '../database/client.js';
import { clusters } from '../database/schema.js';
import {
  getUnclusteredComplaints,
  findMostSimilarCluster,
  insertCluster,
  updateClusterStats,
  assignComplaintToCluster,
  getComplaintsByCluster,
} from '../database/queries.js';
import { eq } from 'drizzle-orm';
import type { Complaint, Cluster } from '../database/schema.js';
import type { ClusteringResult, ClusteringStats } from './types.js';

// =============================================================================
// ANTHROPIC CLIENT SINGLETON
// =============================================================================

let anthropicClient: Anthropic | null = null;

/**
 * Get or create the Anthropic client
 */
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for summary generation'
      );
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Reset the Anthropic client (useful for testing)
 */
export function resetAnthropicClient(): void {
  anthropicClient = null;
}

// =============================================================================
// CLUSTERING ENGINE CLASS
// =============================================================================

/**
 * Configuration for the clustering engine
 */
export interface ClusteringEngineConfig {
  /** Similarity threshold for cluster assignment (default: 0.75) */
  similarityThreshold: number;
  /** Maximum retry attempts for API calls (default: 3) */
  maxRetries: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay: number;
  /** Claude model for summary generation (default: claude-3-5-sonnet-20241022) */
  summaryModel: string;
}

const DEFAULT_CLUSTERING_CONFIG: ClusteringEngineConfig = {
  similarityThreshold: 0.75,
  maxRetries: 3,
  retryBaseDelay: 1000,
  summaryModel: 'claude-3-5-sonnet-20241022',
};

/**
 * ClusteringEngine groups similar complaints using vector similarity.
 * New complaints are assigned to existing clusters if similarity >= threshold,
 * otherwise new clusters are created.
 */
export class ClusteringEngine {
  private config: ClusteringEngineConfig;
  private anthropicClient: Anthropic | null = null;

  constructor(config: Partial<ClusteringEngineConfig> = {}) {
    this.config = { ...DEFAULT_CLUSTERING_CONFIG, ...config };
  }

  /**
   * Get Anthropic client lazily (only when needed for summaries)
   */
  private getClient(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = getAnthropicClient();
    }
    return this.anthropicClient;
  }

  /**
   * Calculate centroid embedding from a list of embeddings
   * Simple average of all vectors
   */
  calculateCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      throw new Error('Cannot calculate centroid of empty embedding list');
    }

    const dimensions = embeddings[0].length;
    const centroid = new Array(dimensions).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += embedding[i];
      }
    }

    // Average
    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  /**
   * Generate a summary for a cluster using Claude API
   */
  async generateClusterSummary(complaintTexts: string[]): Promise<string> {
    // Take up to 10 representative complaints for summary generation
    const sampleTexts = complaintTexts.slice(0, 10);

    try {
      const client = this.getClient();

      const response = await client.messages.create({
        model: this.config.summaryModel,
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: `Analyze these user complaints and create a brief 1-2 sentence summary describing the core problem or pain point they share. Focus on what users are struggling with or frustrated about.

Complaints:
${sampleTexts.map((text, i) => `${i + 1}. "${text.slice(0, 500)}"`).join('\n')}

Write only the problem summary, no introduction or explanation:`,
          },
        ],
      });

      // Extract text from response
      const textContent = response.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        return textContent.text.trim();
      }

      throw new Error('No text content in response');
    } catch (error) {
      console.error('Failed to generate cluster summary:', error);

      // Fallback: Extract common keywords for summary
      return this.generateFallbackSummary(complaintTexts);
    }
  }

  /**
   * Generate a fallback summary when Claude API fails
   * Uses keyword extraction to create a basic summary
   */
  private generateFallbackSummary(complaintTexts: string[]): string {
    // Common words to exclude
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
      'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
      'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and',
      'but', 'if', 'or', 'because', 'as', 'until', 'while', 'this', 'that',
      'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you',
      'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
      'what', 'which', 'who', 'whom', 'any', 'both', 'either', 'neither',
    ]);

    // Count word frequencies
    const wordCounts: Record<string, number> = {};

    for (const text of complaintTexts) {
      const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
      for (const word of words) {
        if (!stopWords.has(word)) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
    }

    // Get top keywords
    const topKeywords = Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    if (topKeywords.length === 0) {
      return 'Multiple users report issues with this functionality.';
    }

    return `Multiple users report issues with ${topKeywords.join(', ')}.`;
  }

  /**
   * Cluster a single complaint
   * Assigns to existing cluster if similar enough, otherwise creates new cluster
   */
  async clusterComplaint(complaint: Complaint): Promise<ClusteringResult> {
    if (!complaint.embedding) {
      throw new Error(`Complaint ${complaint.id} has no embedding`);
    }

    // Find the most similar existing cluster
    const similarCluster = await findMostSimilarCluster(
      complaint.embedding,
      this.config.similarityThreshold
    );

    if (similarCluster) {
      // Assign to existing cluster
      await assignComplaintToCluster(complaint.id, similarCluster.cluster.id);

      // Update cluster statistics
      await this.updateClusterAfterAssignment(
        similarCluster.cluster.id,
        complaint
      );

      return {
        complaintId: complaint.id,
        clusterId: similarCluster.cluster.id,
        isNewCluster: false,
        similarity: similarCluster.similarity,
      };
    } else {
      // Create new cluster
      const newCluster = await this.createClusterForComplaint(complaint);

      return {
        complaintId: complaint.id,
        clusterId: newCluster.id,
        isNewCluster: true,
      };
    }
  }

  /**
   * Create a new cluster for a complaint
   */
  private async createClusterForComplaint(complaint: Complaint): Promise<Cluster> {
    // Generate initial summary
    const summary = await this.generateClusterSummary([complaint.text]);

    // Create the cluster
    const cluster = await insertCluster({
      summary,
      firstSeen: complaint.createdAt,
      lastSeen: complaint.createdAt,
      complaintCount: 1,
      platformDistribution: { [complaint.category]: 1 },
      centroidEmbedding: complaint.embedding!,
    });

    // Assign the complaint to the cluster
    await assignComplaintToCluster(complaint.id, cluster.id);

    return cluster;
  }

  /**
   * Update cluster statistics after assigning a new complaint
   */
  private async updateClusterAfterAssignment(
    clusterId: string,
    newComplaint: Complaint
  ): Promise<void> {
    // Get all complaints in the cluster
    const clusterComplaints = await getComplaintsByCluster(clusterId);

    // Calculate new centroid
    const embeddings = clusterComplaints
      .filter((c) => c.embedding)
      .map((c) => c.embedding as number[]);

    // Add the new complaint's embedding if not already included
    if (!clusterComplaints.find((c) => c.id === newComplaint.id)) {
      embeddings.push(newComplaint.embedding!);
    }

    const newCentroid = this.calculateCentroid(embeddings);

    // Calculate platform distribution
    const platformDistribution: Record<string, number> = {};
    for (const c of clusterComplaints) {
      platformDistribution[c.category] = (platformDistribution[c.category] || 0) + 1;
    }
    // Add new complaint if not counted
    if (!clusterComplaints.find((c) => c.id === newComplaint.id)) {
      platformDistribution[newComplaint.category] =
        (platformDistribution[newComplaint.category] || 0) + 1;
    }

    // Find the latest seen date
    const allDates = clusterComplaints.map((c) => c.createdAt);
    if (!clusterComplaints.find((c) => c.id === newComplaint.id)) {
      allDates.push(newComplaint.createdAt);
    }
    const lastSeen = new Date(Math.max(...allDates.map((d) => d.getTime())));

    // Update cluster
    await updateClusterStats(clusterId, {
      complaintCount: clusterComplaints.length,
      lastSeen,
      platformDistribution,
      centroidEmbedding: newCentroid,
    });
  }

  /**
   * Process all unclustered complaints
   */
  async processUnclustered(limit: number = 100): Promise<ClusteringStats> {
    const stats: ClusteringStats = {
      totalProcessed: 0,
      assignedToExisting: 0,
      newClustersCreated: 0,
      summariesGenerated: 0,
      summaryGenerationFailed: 0,
      errors: [],
    };

    // Get unclustered complaints that have embeddings
    const unclustered = await getUnclusteredComplaints(limit);

    for (const complaint of unclustered) {
      try {
        const result = await this.clusterComplaint(complaint);
        stats.totalProcessed++;

        if (result.isNewCluster) {
          stats.newClustersCreated++;
          stats.summariesGenerated++;
        } else {
          stats.assignedToExisting++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stats.errors.push({
          complaintId: complaint.id,
          message,
        });
      }
    }

    return stats;
  }

  /**
   * Regenerate summary for a specific cluster
   * Useful when a cluster grows significantly
   */
  async regenerateClusterSummary(clusterId: string): Promise<string> {
    const clusterComplaints = await getComplaintsByCluster(clusterId);

    if (clusterComplaints.length === 0) {
      throw new Error(`Cluster ${clusterId} has no complaints`);
    }

    const texts = clusterComplaints.map((c) => c.text);
    const summary = await this.generateClusterSummary(texts);

    // Update the cluster with the new summary
    await db
      .update(clusters)
      .set({ summary, updatedAt: new Date() })
      .where(eq(clusters.id, clusterId));

    return summary;
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create an engine instance and process all unclustered complaints
 */
export async function clusterComplaints(limit?: number): Promise<ClusteringStats> {
  const engine = new ClusteringEngine();
  return engine.processUnclustered(limit);
}
