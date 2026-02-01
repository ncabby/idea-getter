/**
 * Embedding Generator Module
 *
 * Generates 1536-dimensional embeddings for complaint text using OpenAI's
 * text-embedding-ada-002 model. Stores embeddings in the complaints table
 * for vector similarity search.
 *
 * Note: Uses OpenAI for embeddings as the database schema requires 1536 dimensions,
 * which matches OpenAI's ada-002 model. Anthropic/Claude is used for text generation
 * tasks like summary creation.
 */

import OpenAI from 'openai';
import { db } from '../database/client.js';
import { complaints } from '../database/schema.js';
import { eq, sql } from 'drizzle-orm';
import type { Complaint } from '../database/schema.js';
import type {
  EmbeddingResult,
  EmbeddingStats,
} from './types.js';

// =============================================================================
// OPENAI CLIENT SINGLETON
// =============================================================================

let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client
 */
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is required for embedding generation'
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Reset the OpenAI client (useful for testing)
 */
export function resetOpenAIClient(): void {
  openaiClient = null;
}

// =============================================================================
// EMBEDDING GENERATOR CLASS
// =============================================================================

/**
 * Configuration for the embedding generator
 */
export interface EmbeddingGeneratorConfig {
  /** Batch size for processing (default: 50) */
  batchSize: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay: number;
  /** OpenAI model for embeddings (default: text-embedding-ada-002) */
  model: string;
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingGeneratorConfig = {
  batchSize: 50,
  maxRetries: 3,
  retryBaseDelay: 1000,
  model: 'text-embedding-ada-002',
};

/**
 * EmbeddingGenerator creates vector embeddings for complaint text.
 * Uses OpenAI's text-embedding-ada-002 for 1536-dimensional embeddings.
 */
export class EmbeddingGenerator {
  private config: EmbeddingGeneratorConfig;
  private client: OpenAI;

  constructor(config: Partial<EmbeddingGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
    this.client = getOpenAIClient();
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // Truncate text if too long (OpenAI has token limits)
    const truncatedText = text.slice(0, 8000);

    const response = await this.client.embeddings.create({
      model: this.config.model,
      input: truncatedText,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple texts with retry logic
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Truncate texts
    const truncatedTexts = texts.map((t) => t.slice(0, 8000));

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.config.model,
          input: truncatedTexts,
        });

        return response.data.map((d) => d.embedding);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Exponential backoff
        const delay = this.config.retryBaseDelay * Math.pow(2, attempt);
        console.error(
          `Embedding generation failed (attempt ${attempt + 1}/${this.config.maxRetries}): ${lastError.message}`
        );

        if (attempt < this.config.maxRetries - 1) {
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Embedding generation failed after all retries');
  }

  /**
   * Process a batch of complaints and generate their embeddings
   */
  async processBatch(complaintsList: Complaint[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    const textsToEmbed: { complaint: Complaint; index: number }[] = [];

    // Filter out complaints that already have embeddings (caching)
    for (let i = 0; i < complaintsList.length; i++) {
      const complaint = complaintsList[i];
      if (complaint.embedding) {
        // Already has embedding - mark as cached success
        results.push({
          complaintId: complaint.id,
          success: true,
          embedding: complaint.embedding,
        });
      } else {
        textsToEmbed.push({ complaint, index: i });
      }
    }

    if (textsToEmbed.length === 0) {
      return results;
    }

    try {
      // Generate embeddings for all texts at once
      const embeddings = await this.generateEmbeddings(
        textsToEmbed.map((t) => t.complaint.text)
      );

      // Update database and collect results
      for (let i = 0; i < textsToEmbed.length; i++) {
        const { complaint } = textsToEmbed[i];
        const embedding = embeddings[i];

        // Update the complaint with the embedding
        await db
          .update(complaints)
          .set({ embedding })
          .where(eq(complaints.id, complaint.id));

        results.push({
          complaintId: complaint.id,
          success: true,
          embedding,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Mark all complaints in this batch as failed
      for (const { complaint } of textsToEmbed) {
        // On failure, mark as not a complaint (per spec)
        await db
          .update(complaints)
          .set({ isComplaint: false })
          .where(eq(complaints.id, complaint.id));

        results.push({
          complaintId: complaint.id,
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Process all complaints that need embeddings
   * Only processes complaints marked as is_complaint=true
   */
  async processComplaints(limit: number = 500): Promise<EmbeddingStats> {
    const stats: EmbeddingStats = {
      totalProcessed: 0,
      successfulEmbeddings: 0,
      failedEmbeddings: 0,
      cachedEmbeddings: 0,
      batchesProcessed: 0,
      errors: [],
    };

    // Fetch complaints that are marked as complaints but don't have embeddings yet
    const complaintsToProcess = await db
      .select()
      .from(complaints)
      .where(
        sql`${complaints.isComplaint} = true AND ${complaints.embedding} IS NULL`
      )
      .limit(limit);

    if (complaintsToProcess.length === 0) {
      return stats;
    }

    // Process in batches
    for (let i = 0; i < complaintsToProcess.length; i += this.config.batchSize) {
      const batch = complaintsToProcess.slice(i, i + this.config.batchSize);
      const results = await this.processBatch(batch);

      stats.batchesProcessed++;
      stats.totalProcessed += results.length;

      for (const result of results) {
        if (result.success) {
          stats.successfulEmbeddings++;
        } else {
          stats.failedEmbeddings++;
          if (result.error) {
            stats.errors.push({
              complaintId: result.complaintId,
              message: result.error,
            });
          }
        }
      }
    }

    return stats;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a generator instance and process all complaints needing embeddings
 */
export async function generateEmbeddings(limit?: number): Promise<EmbeddingStats> {
  const generator = new EmbeddingGenerator();
  return generator.processComplaints(limit);
}

/**
 * Generate a single embedding for a text string
 */
export async function generateSingleEmbedding(text: string): Promise<number[]> {
  const generator = new EmbeddingGenerator();
  return generator.generateEmbedding(text);
}
