/**
 * Complaint Detector Module
 *
 * Pattern matching system to identify frustration language and failure descriptions
 * in scraped Reddit content. Updates the is_complaint flag in the complaints table.
 */

import { db } from '../database/client.js';
import { complaints } from '../database/schema.js';
import { eq, sql } from 'drizzle-orm';
import type {
  DetectionPatterns,
  DetectionResult,
  DetectionStats,
} from './types.js';

// =============================================================================
// DETECTION PATTERNS
// =============================================================================

/**
 * Default patterns for complaint detection
 * These patterns are case-insensitive and match word boundaries
 */
export const DEFAULT_DETECTION_PATTERNS: DetectionPatterns = {
  // Frustration language patterns
  frustration: [
    /\b(frustrated|frustrating|frustration)\b/i,
    /\b(annoying|annoyed|annoyance)\b/i,
    /\b(painful|pain point)\b/i,
    /\b(hate|hating|hated)\b/i,
    /\b(terrible|terribly)\b/i,
    /\b(awful|awfully)\b/i,
    /\b(nightmare)\b/i,
    /\b(drives? me crazy|driving me crazy)\b/i,
    /\b(fed up|sick of|tired of)\b/i,
    /\b(unbearable|intolerable)\b/i,
    /\b(infuriating|maddening)\b/i,
  ],

  // Failure description patterns
  failure: [
    /\b(doesn'?t work|does not work|don'?t work|do not work)\b/i,
    /\b(broken|is broken|was broken)\b/i,
    /\b(failed|failing|fails)\b/i,
    /\b(can'?t|cannot|couldn'?t|could not)\b/i,
    /\b(unable to)\b/i,
    /\b(won'?t|will not)\b/i,
    /\b(stopped working)\b/i,
    /\b(keeps crashing|keeps failing)\b/i,
    /\b(bug|buggy|bugs)\b/i,
    /\b(error|errors|erroring)\b/i,
    /\b(never works|rarely works)\b/i,
    /\b(completely broken)\b/i,
  ],

  // Problem statement patterns
  problem: [
    /\b(no way to)\b/i,
    /\b(impossible to)\b/i,
    /\b(hard to|difficult to)\b/i,
    /\b(struggle to|struggling to|struggled to)\b/i,
    /\b(can'?t figure out|cannot figure out)\b/i,
    /\b(need a better|needs a better)\b/i,
    /\b(wish there was|wish I could|wish we could)\b/i,
    /\b(looking for a solution|looking for an alternative)\b/i,
    /\b(anyone know how to|does anyone know)\b/i,
    /\b(there must be a way|there has to be a way)\b/i,
    /\b(why is it so hard|why is this so)\b/i,
    /\b(missing feature|lacking feature)\b/i,
    /\b(no option to|no way of)\b/i,
    /\b(should be able to|should be easier)\b/i,
  ],
};

// =============================================================================
// COMPLAINT DETECTOR CLASS
// =============================================================================

/**
 * ComplaintDetector analyzes text content to identify user complaints
 * using pattern matching on frustration language, failure descriptions,
 * and problem statements.
 */
export class ComplaintDetector {
  private patterns: DetectionPatterns;

  constructor(patterns: DetectionPatterns = DEFAULT_DETECTION_PATTERNS) {
    this.patterns = patterns;
  }

  /**
   * Detect if a single text is a complaint
   */
  detectComplaint(text: string): {
    isComplaint: boolean;
    matchedPatterns: { frustration: string[]; failure: string[]; problem: string[] };
    confidence: number;
  } {
    const matchedPatterns = {
      frustration: [] as string[],
      failure: [] as string[],
      problem: [] as string[],
    };

    // Check frustration patterns
    for (const pattern of this.patterns.frustration) {
      const match = text.match(pattern);
      if (match) {
        matchedPatterns.frustration.push(match[0]);
      }
    }

    // Check failure patterns
    for (const pattern of this.patterns.failure) {
      const match = text.match(pattern);
      if (match) {
        matchedPatterns.failure.push(match[0]);
      }
    }

    // Check problem patterns
    for (const pattern of this.patterns.problem) {
      const match = text.match(pattern);
      if (match) {
        matchedPatterns.problem.push(match[0]);
      }
    }

    // Calculate total matches
    const totalMatches =
      matchedPatterns.frustration.length +
      matchedPatterns.failure.length +
      matchedPatterns.problem.length;

    // Determine if it's a complaint (at least one match in any category)
    const isComplaint = totalMatches > 0;

    // Calculate confidence based on number of matches and categories hit
    const categoriesHit = [
      matchedPatterns.frustration.length > 0,
      matchedPatterns.failure.length > 0,
      matchedPatterns.problem.length > 0,
    ].filter(Boolean).length;

    // Confidence: base on number of matches (capped at 100%)
    // More matches and more categories = higher confidence
    const confidence = Math.min(
      100,
      totalMatches * 15 + categoriesHit * 20
    );

    return { isComplaint, matchedPatterns, confidence };
  }

  /**
   * Process a batch of complaints and update their is_complaint flag
   */
  async detectAndUpdate(complaintIds: string[]): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];

    // Fetch complaints by IDs
    const complaintsToProcess = await db
      .select()
      .from(complaints)
      .where(sql`${complaints.id} = ANY(${complaintIds})`);

    for (const complaint of complaintsToProcess) {
      const detection = this.detectComplaint(complaint.text);

      // Update the complaint in the database
      await db
        .update(complaints)
        .set({ isComplaint: detection.isComplaint })
        .where(eq(complaints.id, complaint.id));

      results.push({
        complaintId: complaint.id,
        isComplaint: detection.isComplaint,
        matchedPatterns: detection.matchedPatterns,
        confidence: detection.confidence,
      });
    }

    return results;
  }

  /**
   * Process all unprocessed complaints (where is_complaint is still false and no embedding)
   * This is for newly scraped items that haven't been analyzed yet
   */
  async processNewComplaints(limit: number = 100): Promise<DetectionStats> {
    const stats: DetectionStats = {
      totalProcessed: 0,
      complaintsDetected: 0,
      nonComplaints: 0,
      patternBreakdown: {
        frustration: 0,
        failure: 0,
        problem: 0,
      },
    };

    // Fetch complaints that haven't been processed (no embedding yet)
    // These are fresh from scraping
    const unprocessedComplaints = await db
      .select()
      .from(complaints)
      .where(sql`${complaints.embedding} IS NULL`)
      .limit(limit);

    for (const complaint of unprocessedComplaints) {
      const detection = this.detectComplaint(complaint.text);

      // Update the is_complaint flag
      await db
        .update(complaints)
        .set({ isComplaint: detection.isComplaint })
        .where(eq(complaints.id, complaint.id));

      stats.totalProcessed++;

      if (detection.isComplaint) {
        stats.complaintsDetected++;
      } else {
        stats.nonComplaints++;
      }

      // Track pattern breakdown
      if (detection.matchedPatterns.frustration.length > 0) {
        stats.patternBreakdown.frustration++;
      }
      if (detection.matchedPatterns.failure.length > 0) {
        stats.patternBreakdown.failure++;
      }
      if (detection.matchedPatterns.problem.length > 0) {
        stats.patternBreakdown.problem++;
      }
    }

    return stats;
  }

  /**
   * Get current detection patterns
   */
  getPatterns(): DetectionPatterns {
    return this.patterns;
  }

  /**
   * Update detection patterns
   */
  setPatterns(patterns: Partial<DetectionPatterns>): void {
    this.patterns = { ...this.patterns, ...patterns };
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a detector instance and process all new complaints
 */
export async function detectComplaints(limit?: number): Promise<DetectionStats> {
  const detector = new ComplaintDetector();
  return detector.processNewComplaints(limit);
}
