import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const { Pool } = pg;

/**
 * Run database migrations
 *
 * This script:
 * 1. Enables the pgvector extension
 * 2. Runs all Drizzle migrations
 * 3. Creates HNSW indexes for vector similarity search
 */
async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  console.log('Connecting to database...');
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    // Step 1: Enable pgvector extension
    console.log('Enabling pgvector extension...');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('pgvector extension enabled');

    // Step 2: Run Drizzle migrations
    console.log('Running Drizzle migrations...');
    await migrate(db, { migrationsFolder: './migrations' });
    console.log('Drizzle migrations completed');

    // Step 3: Create HNSW indexes for vector columns
    // These are created after table migrations to ensure tables exist
    console.log('Creating vector indexes...');

    // HNSW index on complaints.embedding for efficient similarity search
    await pool.query(`
      CREATE INDEX IF NOT EXISTS complaints_embedding_hnsw_idx
      ON complaints
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);
    console.log('Created HNSW index on complaints.embedding');

    // HNSW index on clusters.centroid_embedding for cluster similarity search
    await pool.query(`
      CREATE INDEX IF NOT EXISTS clusters_centroid_embedding_hnsw_idx
      ON clusters
      USING hnsw (centroid_embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);
    console.log('Created HNSW index on clusters.centroid_embedding');

    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migrations if this file is executed directly
runMigrations().catch((error) => {
  console.error('Migration script failed:', error);
  process.exit(1);
});
