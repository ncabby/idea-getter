/**
 * Database Module
 *
 * Provides type-safe database access for the Idea Getter system.
 * Uses Drizzle ORM with PostgreSQL and pgvector for vector similarity search.
 */

// Export database client and connection utilities
export {
  db,
  pool,
  schema,
  checkDatabaseHealth,
  closeDatabaseConnection,
  setupGracefulShutdown,
  initializeDatabase,
} from './client.js';

// Export schema and types
export {
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
  type NewSetting,
  type SystemMetadataRecord,
  type NewSystemMetadataRecord,
} from './schema.js';

// Export query builders
export {
  queries,
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
} from './queries.js';
