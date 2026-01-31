import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';

/**
 * Custom type for pgvector's vector type
 * Used for storing embeddings (1536-dimensional vectors from Claude)
 */
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    const dimensions = config?.dimensions ?? 1536;
    return `vector(${dimensions})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Parse the vector string format: [1,2,3,...] or (1,2,3,...)
    const cleaned = value.replace(/[\[\]()]/g, '');
    return cleaned.split(',').map(Number);
  },
});

// =============================================================================
// COMPLAINTS TABLE
// =============================================================================
/**
 * Stores raw scraped content from Reddit.
 * Each record represents a single post or comment that may be a user complaint.
 */
export const complaints = pgTable(
  'complaints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourcePlatform: varchar('source_platform', { length: 50 }).notNull().default('reddit'),
    sourceId: varchar('source_id', { length: 255 }).notNull(),
    sourceUrl: text('source_url').notNull(),
    subreddit: varchar('subreddit', { length: 100 }).notNull(),
    author: varchar('author', { length: 100 }).notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
    embedding: vector('embedding', { dimensions: 1536 }),
    isComplaint: boolean('is_complaint').notNull().default(false),
    clusterId: uuid('cluster_id').references(() => clusters.id, { onDelete: 'set null' }),
  },
  (table) => [
    // Index for 30-day window queries
    index('complaints_created_at_idx').on(table.createdAt),
    // Index for cluster lookups
    index('complaints_cluster_id_idx').on(table.clusterId),
    // Uniqueness constraint to prevent duplicate scraping
    uniqueIndex('complaints_source_unique_idx').on(table.sourcePlatform, table.sourceId),
    // Index for filtering complaints
    index('complaints_is_complaint_idx').on(table.isComplaint),
  ]
);

// =============================================================================
// CLUSTERS TABLE
// =============================================================================
/**
 * Groups of similar complaints representing a pain point.
 * Clusters are formed using semantic similarity of complaint embeddings.
 */
export const clusters = pgTable(
  'clusters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    summary: text('summary').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
    complaintCount: integer('complaint_count').notNull().default(0),
    platformDistribution: jsonb('platform_distribution').$type<Record<string, number>>().notNull().default({}),
    centroidEmbedding: vector('centroid_embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Index for active cluster queries
    index('clusters_last_seen_idx').on(table.lastSeen),
    // Index for filtering by complaint count
    index('clusters_complaint_count_idx').on(table.complaintCount),
  ]
);

// =============================================================================
// OPPORTUNITIES TABLE
// =============================================================================
/**
 * Scored clusters that meet threshold criteria.
 * Each opportunity is linked to exactly one cluster and contains scoring metadata.
 */
export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clusterId: uuid('cluster_id')
      .notNull()
      .unique()
      .references(() => clusters.id, { onDelete: 'cascade' }),
    score: integer('score').notNull().default(0),
    scoringFactors: jsonb('scoring_factors')
      .$type<{
        complaintCount: number;
        daysActive: number;
        growthPercentage: number;
        workaroundCount: number;
        platformCount: number;
      }>()
      .notNull()
      .default({
        complaintCount: 0,
        daysActive: 0,
        growthPercentage: 0,
        workaroundCount: 0,
        platformCount: 0,
      }),
    representativeQuoteId: uuid('representative_quote_id').references(() => complaints.id, {
      onDelete: 'set null',
    }),
    isBookmarked: boolean('is_bookmarked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Index for sorting by score
    index('opportunities_score_idx').on(table.score),
    // Index for filtering bookmarked opportunities
    index('opportunities_is_bookmarked_idx').on(table.isBookmarked),
    // Index for date sorting
    index('opportunities_created_at_idx').on(table.createdAt),
  ]
);

// =============================================================================
// SETTINGS TABLE
// =============================================================================
/**
 * System configuration (thresholds, sources).
 * Stores key-value pairs with flexible JSON values.
 */
export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull().unique(),
    value: jsonb('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique index on key for fast lookups
    uniqueIndex('settings_key_unique_idx').on(table.key),
  ]
);

// =============================================================================
// SYSTEM METADATA TABLE
// =============================================================================
/**
 * Tracks job runs and system statistics.
 * Used for monitoring pipeline health and debugging.
 */
export const systemMetadata = pgTable(
  'system_metadata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobType: varchar('job_type', { length: 50 }).notNull(),
    runStartedAt: timestamp('run_started_at', { withTimezone: true }).notNull().defaultNow(),
    runCompletedAt: timestamp('run_completed_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    errors: jsonb('errors').$type<Array<{ message: string; stack?: string; timestamp: string }>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    // Composite index for latest run queries
    index('system_metadata_job_type_run_started_at_idx').on(table.jobType, table.runStartedAt),
    // Index for status filtering
    index('system_metadata_status_idx').on(table.status),
  ]
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================
export type Complaint = typeof complaints.$inferSelect;
export type NewComplaint = typeof complaints.$inferInsert;

export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type SystemMetadataRecord = typeof systemMetadata.$inferSelect;
export type NewSystemMetadataRecord = typeof systemMetadata.$inferInsert;
