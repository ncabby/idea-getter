/**
 * Cleanup Service
 *
 * Handles archiving and cleanup of old data:
 * - Delete complaints older than retention period (default: 30 days)
 * - Delete empty clusters (clusters with no complaints)
 * - Delete orphaned opportunities (opportunities for deleted clusters)
 */

import {
  deleteOldComplaints,
  deleteEmptyClusters,
  deleteOrphanedOpportunities,
  getSetting,
} from '../database/index.js';
import {
  type CleanupConfig,
  type CleanupStats,
  DEFAULT_CLEANUP_CONFIG,
} from './types.js';

/**
 * CleanupService handles periodic cleanup of stale data
 */
export class CleanupService {
  private config: CleanupConfig;

  constructor(config: Partial<CleanupConfig> = {}) {
    this.config = { ...DEFAULT_CLEANUP_CONFIG, ...config };
  }

  /**
   * Load config from database settings if available
   */
  private async loadConfigFromSettings(): Promise<void> {
    try {
      const retentionDays = await getSetting<number>('data_retention_days');
      if (retentionDays !== undefined) {
        this.config.retentionDays = retentionDays;
      }
    } catch {
      // Use default config if settings unavailable
    }
  }

  /**
   * Run the full cleanup process
   */
  async archiveOldData(): Promise<CleanupStats> {
    const startTime = Date.now();
    const errors: Array<{ operation: string; message: string }> = [];

    // Load config from database
    await this.loadConfigFromSettings();

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    console.log(`\nCleanup: Removing data older than ${cutoffDate.toISOString()}`);

    let complaintsDeleted = 0;
    let clustersDeleted = 0;
    let opportunitiesDeleted = 0;

    // Step 1: Delete old complaints
    // This should be done first as it may create empty clusters
    try {
      complaintsDeleted = await deleteOldComplaints(cutoffDate);
      console.log(`  Deleted ${complaintsDeleted} old complaints`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ operation: 'deleteOldComplaints', message });
      console.error(`  Failed to delete old complaints: ${message}`);
    }

    // Step 2: Delete empty clusters (clusters with no complaints)
    // After deleting old complaints, some clusters may become empty
    try {
      clustersDeleted = await deleteEmptyClusters();
      console.log(`  Deleted ${clustersDeleted} empty clusters`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ operation: 'deleteEmptyClusters', message });
      console.error(`  Failed to delete empty clusters: ${message}`);
    }

    // Step 3: Delete orphaned opportunities
    // Opportunities reference clusters that may have been deleted
    // Note: With cascade delete on cluster_id, this should happen automatically
    // but we run it anyway as a safety measure
    try {
      opportunitiesDeleted = await deleteOrphanedOpportunities();
      console.log(`  Deleted ${opportunitiesDeleted} orphaned opportunities`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ operation: 'deleteOrphanedOpportunities', message });
      console.error(`  Failed to delete orphaned opportunities: ${message}`);
    }

    const durationMs = Date.now() - startTime;

    const stats: CleanupStats = {
      complaintsDeleted,
      clustersDeleted,
      opportunitiesDeleted,
      cutoffDate,
      durationMs,
      errors,
    };

    console.log(`Cleanup completed in ${durationMs}ms`);
    if (errors.length > 0) {
      console.log(`  ${errors.length} error(s) encountered`);
    }

    return stats;
  }
}

/**
 * Run cleanup with default configuration
 */
export async function runCleanup(config?: Partial<CleanupConfig>): Promise<CleanupStats> {
  const service = new CleanupService(config);
  return service.archiveOldData();
}
