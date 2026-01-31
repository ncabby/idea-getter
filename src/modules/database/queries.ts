import { eq, gte, desc, asc, and, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import {
  complaints,
  clusters,
  opportunities,
  settings,
  systemMetadata,
  type Complaint,
  type NewComplaint,
  type Cluster,
  type NewCluster,
  type Opportunity,
  type NewOpportunity,
  type Setting,
  type SystemMetadataRecord,
} from './schema.js';

// =============================================================================
// COMPLAINTS QUERIES
// =============================================================================

/**
 * Insert a new complaint
 */
export async function insertComplaint(complaint: NewComplaint): Promise<Complaint> {
  const [result] = await db.insert(complaints).values(complaint).returning();
  return result;
}

/**
 * Insert multiple complaints (bulk insert)
 */
export async function insertComplaints(complaintsList: NewComplaint[]): Promise<Complaint[]> {
  if (complaintsList.length === 0) return [];
  return await db.insert(complaints).values(complaintsList).returning();
}

/**
 * Update complaint with embedding and cluster assignment
 */
export async function updateComplaintEmbedding(
  id: string,
  embedding: number[],
  isComplaint: boolean
): Promise<Complaint | undefined> {
  const [result] = await db
    .update(complaints)
    .set({ embedding, isComplaint })
    .where(eq(complaints.id, id))
    .returning();
  return result;
}

/**
 * Assign complaint to a cluster
 */
export async function assignComplaintToCluster(
  complaintId: string,
  clusterId: string
): Promise<void> {
  await db.update(complaints).set({ clusterId }).where(eq(complaints.id, complaintId));
}

/**
 * Get complaints without embeddings
 */
export async function getComplaintsWithoutEmbeddings(limit: number = 100): Promise<Complaint[]> {
  return await db
    .select()
    .from(complaints)
    .where(sql`${complaints.embedding} IS NULL`)
    .limit(limit);
}

/**
 * Get complaints that are detected as complaints but not yet clustered
 */
export async function getUnclusteredComplaints(limit: number = 100): Promise<Complaint[]> {
  return await db
    .select()
    .from(complaints)
    .where(
      and(
        eq(complaints.isComplaint, true),
        sql`${complaints.clusterId} IS NULL`,
        sql`${complaints.embedding} IS NOT NULL`
      )
    )
    .limit(limit);
}

/**
 * Get complaints by cluster ID
 */
export async function getComplaintsByCluster(clusterId: string): Promise<Complaint[]> {
  return await db.select().from(complaints).where(eq(complaints.clusterId, clusterId));
}

/**
 * Get complaint by source platform and ID (for deduplication)
 */
export async function getComplaintBySource(
  sourcePlatform: string,
  sourceId: string
): Promise<Complaint | undefined> {
  const [result] = await db
    .select()
    .from(complaints)
    .where(and(eq(complaints.sourcePlatform, sourcePlatform), eq(complaints.sourceId, sourceId)));
  return result;
}

/**
 * Find similar complaints using vector similarity search
 * Requires pgvector extension
 */
export async function findSimilarComplaints(
  embedding: number[],
  threshold: number = 0.75,
  limit: number = 10
): Promise<Array<Complaint & { similarity: number }>> {
  const embeddingStr = `[${embedding.join(',')}]`;
  const result = await pool.query<Complaint & { similarity: number }>(
    `SELECT *, 1 - (embedding <=> $1::vector) as similarity
     FROM complaints
     WHERE embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [embeddingStr, threshold, limit]
  );
  return result.rows;
}

/**
 * Delete complaints older than specified date
 */
export async function deleteOldComplaints(olderThan: Date): Promise<number> {
  const result = await db
    .delete(complaints)
    .where(sql`${complaints.createdAt} < ${olderThan}`)
    .returning({ id: complaints.id });
  return result.length;
}

// =============================================================================
// CLUSTERS QUERIES
// =============================================================================

/**
 * Insert a new cluster
 */
export async function insertCluster(cluster: NewCluster): Promise<Cluster> {
  const [result] = await db.insert(clusters).values(cluster).returning();
  return result;
}

/**
 * Update cluster statistics
 */
export async function updateClusterStats(
  id: string,
  stats: {
    complaintCount?: number;
    lastSeen?: Date;
    platformDistribution?: Record<string, number>;
    centroidEmbedding?: number[];
  }
): Promise<Cluster | undefined> {
  const [result] = await db
    .update(clusters)
    .set({
      ...stats,
      updatedAt: new Date(),
    })
    .where(eq(clusters.id, id))
    .returning();
  return result;
}

/**
 * Get cluster by ID
 */
export async function getClusterById(id: string): Promise<Cluster | undefined> {
  const [result] = await db.select().from(clusters).where(eq(clusters.id, id));
  return result;
}

/**
 * Get all active clusters (with recent activity)
 */
export async function getActiveClusters(minComplaintCount: number = 1): Promise<Cluster[]> {
  return await db
    .select()
    .from(clusters)
    .where(gte(clusters.complaintCount, minComplaintCount))
    .orderBy(desc(clusters.lastSeen));
}

/**
 * Find the most similar cluster for a given embedding
 */
export async function findMostSimilarCluster(
  embedding: number[],
  threshold: number = 0.75
): Promise<{ cluster: Cluster; similarity: number } | null> {
  const embeddingStr = `[${embedding.join(',')}]`;
  const result = await pool.query<Cluster & { similarity: number }>(
    `SELECT *, 1 - (centroid_embedding <=> $1::vector) as similarity
     FROM clusters
     WHERE centroid_embedding IS NOT NULL
       AND 1 - (centroid_embedding <=> $1::vector) >= $2
     ORDER BY centroid_embedding <=> $1::vector
     LIMIT 1`,
    [embeddingStr, threshold]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return { cluster: row, similarity: row.similarity };
}

/**
 * Delete clusters with no complaints
 */
export async function deleteEmptyClusters(): Promise<number> {
  const result = await db
    .delete(clusters)
    .where(eq(clusters.complaintCount, 0))
    .returning({ id: clusters.id });
  return result.length;
}

// =============================================================================
// OPPORTUNITIES QUERIES
// =============================================================================

/**
 * Insert or update an opportunity
 */
export async function upsertOpportunity(opportunity: NewOpportunity): Promise<Opportunity> {
  const [result] = await db
    .insert(opportunities)
    .values(opportunity)
    .onConflictDoUpdate({
      target: opportunities.clusterId,
      set: {
        score: opportunity.score,
        scoringFactors: opportunity.scoringFactors,
        representativeQuoteId: opportunity.representativeQuoteId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

/**
 * Get opportunities above a minimum score threshold
 */
export async function getOpportunities(
  minScore: number = 0,
  options: { sortBy?: 'score' | 'createdAt'; sortOrder?: 'asc' | 'desc' } = {}
): Promise<Opportunity[]> {
  const { sortBy = 'score', sortOrder = 'desc' } = options;

  const orderByColumn = sortBy === 'score' ? opportunities.score : opportunities.createdAt;
  const orderByDirection = sortOrder === 'desc' ? desc(orderByColumn) : asc(orderByColumn);

  return await db
    .select()
    .from(opportunities)
    .where(gte(opportunities.score, minScore))
    .orderBy(orderByDirection);
}

/**
 * Get opportunity by ID with full details (cluster and quotes)
 */
export async function getOpportunityDetails(id: string): Promise<{
  opportunity: Opportunity;
  cluster: Cluster;
  quotes: Complaint[];
} | null> {
  const [opportunity] = await db.select().from(opportunities).where(eq(opportunities.id, id));

  if (!opportunity) return null;

  const [cluster] = await db.select().from(clusters).where(eq(clusters.id, opportunity.clusterId));

  if (!cluster) return null;

  const quotes = await db
    .select()
    .from(complaints)
    .where(eq(complaints.clusterId, cluster.id))
    .orderBy(desc(complaints.createdAt));

  return { opportunity, cluster, quotes };
}

/**
 * Toggle bookmark status for an opportunity
 */
export async function toggleOpportunityBookmark(id: string): Promise<Opportunity | undefined> {
  const [current] = await db.select().from(opportunities).where(eq(opportunities.id, id));

  if (!current) return undefined;

  const [result] = await db
    .update(opportunities)
    .set({
      isBookmarked: !current.isBookmarked,
      updatedAt: new Date(),
    })
    .where(eq(opportunities.id, id))
    .returning();

  return result;
}

/**
 * Get bookmarked opportunities
 */
export async function getBookmarkedOpportunities(): Promise<Opportunity[]> {
  return await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.isBookmarked, true))
    .orderBy(desc(opportunities.score));
}

/**
 * Delete opportunities for clusters that no longer exist
 */
export async function deleteOrphanedOpportunities(): Promise<number> {
  const result = await db
    .delete(opportunities)
    .where(
      sql`${opportunities.clusterId} NOT IN (SELECT id FROM clusters)`
    )
    .returning({ id: opportunities.id });
  return result.length;
}

// =============================================================================
// SETTINGS QUERIES
// =============================================================================

/**
 * Get a setting by key
 */
export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const [result] = await db.select().from(settings).where(eq(settings.key, key));
  return result?.value as T | undefined;
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<Setting[]> {
  return await db.select().from(settings);
}

/**
 * Set a setting value (upsert)
 */
export async function setSetting(
  key: string,
  value: unknown,
  description?: string
): Promise<Setting> {
  const [result] = await db
    .insert(settings)
    .values({ key, value, description })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value,
        description: description,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

/**
 * Delete a setting
 */
export async function deleteSetting(key: string): Promise<boolean> {
  const result = await db.delete(settings).where(eq(settings.key, key)).returning({ id: settings.id });
  return result.length > 0;
}

// =============================================================================
// SYSTEM METADATA QUERIES
// =============================================================================

/**
 * Start a new job run
 */
export async function startJobRun(
  jobType: string,
  metadata?: Record<string, unknown>
): Promise<SystemMetadataRecord> {
  const [result] = await db
    .insert(systemMetadata)
    .values({
      jobType,
      status: 'running',
      metadata,
    })
    .returning();
  return result;
}

/**
 * Complete a job run
 */
export async function completeJobRun(
  id: string,
  itemsProcessed: number,
  metadata?: Record<string, unknown>
): Promise<SystemMetadataRecord | undefined> {
  const [result] = await db
    .update(systemMetadata)
    .set({
      status: 'completed',
      runCompletedAt: new Date(),
      itemsProcessed,
      metadata,
    })
    .where(eq(systemMetadata.id, id))
    .returning();
  return result;
}

/**
 * Fail a job run
 */
export async function failJobRun(
  id: string,
  errors: Array<{ message: string; stack?: string; timestamp: string }>,
  itemsProcessed: number = 0
): Promise<SystemMetadataRecord | undefined> {
  const [result] = await db
    .update(systemMetadata)
    .set({
      status: 'failed',
      runCompletedAt: new Date(),
      itemsProcessed,
      errors,
    })
    .where(eq(systemMetadata.id, id))
    .returning();
  return result;
}

/**
 * Get the latest job run for a specific job type
 */
export async function getLatestJobRun(jobType: string): Promise<SystemMetadataRecord | undefined> {
  const [result] = await db
    .select()
    .from(systemMetadata)
    .where(eq(systemMetadata.jobType, jobType))
    .orderBy(desc(systemMetadata.runStartedAt))
    .limit(1);
  return result;
}

/**
 * Get job runs for today
 */
export async function getTodaysJobRuns(jobType?: string): Promise<SystemMetadataRecord[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let query = db
    .select()
    .from(systemMetadata)
    .where(gte(systemMetadata.runStartedAt, today));

  if (jobType) {
    query = db
      .select()
      .from(systemMetadata)
      .where(and(gte(systemMetadata.runStartedAt, today), eq(systemMetadata.jobType, jobType)));
  }

  return await query.orderBy(desc(systemMetadata.runStartedAt));
}

/**
 * Check if a job is currently running
 */
export async function isJobRunning(jobType: string): Promise<boolean> {
  const [result] = await db
    .select()
    .from(systemMetadata)
    .where(and(eq(systemMetadata.jobType, jobType), eq(systemMetadata.status, 'running')))
    .limit(1);
  return result !== undefined;
}

/**
 * Get system statistics
 */
export async function getSystemStats(): Promise<{
  totalComplaints: number;
  totalClusters: number;
  totalOpportunities: number;
  lastJobRun: SystemMetadataRecord | undefined;
}> {
  const [complaintsCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(complaints);
  const [clustersCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clusters);
  const [opportunitiesCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(opportunities);
  const lastJobRun = await getLatestJobRun('daily-pipeline');

  return {
    totalComplaints: Number(complaintsCount?.count ?? 0),
    totalClusters: Number(clustersCount?.count ?? 0),
    totalOpportunities: Number(opportunitiesCount?.count ?? 0),
    lastJobRun,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const queries = {
  // Complaints
  insertComplaint,
  insertComplaints,
  updateComplaintEmbedding,
  assignComplaintToCluster,
  getComplaintsWithoutEmbeddings,
  getUnclusteredComplaints,
  getComplaintsByCluster,
  getComplaintBySource,
  findSimilarComplaints,
  deleteOldComplaints,

  // Clusters
  insertCluster,
  updateClusterStats,
  getClusterById,
  getActiveClusters,
  findMostSimilarCluster,
  deleteEmptyClusters,

  // Opportunities
  upsertOpportunity,
  getOpportunities,
  getOpportunityDetails,
  toggleOpportunityBookmark,
  getBookmarkedOpportunities,
  deleteOrphanedOpportunities,

  // Settings
  getSetting,
  getAllSettings,
  setSetting,
  deleteSetting,

  // System Metadata
  startJobRun,
  completeJobRun,
  failJobRun,
  getLatestJobRun,
  getTodaysJobRuns,
  isJobRunning,
  getSystemStats,
};
