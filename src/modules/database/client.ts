import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

/**
 * Database connection configuration
 */
interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

/**
 * Get database configuration from environment variables
 */
function getDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return {
      connectionString,
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
      idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'idea_getter',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
    idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  };
}

/**
 * Create PostgreSQL connection pool
 */
function createPool(config: DatabaseConfig): pg.Pool {
  const poolConfig: pg.PoolConfig = config.connectionString
    ? {
        connectionString: config.connectionString,
        max: config.maxConnections,
        idleTimeoutMillis: config.idleTimeoutMs,
        connectionTimeoutMillis: config.connectionTimeoutMs,
      }
    : {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.maxConnections,
        idleTimeoutMillis: config.idleTimeoutMs,
        connectionTimeoutMillis: config.connectionTimeoutMs,
      };

  return new Pool(poolConfig);
}

// Create the connection pool
const config = getDatabaseConfig();
export const pool = createPool(config);

// Create the Drizzle client with schema
export const db = drizzle(pool, { schema });

// Export schema for use in queries
export { schema };

/**
 * Check if the database connection is healthy
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Gracefully close all database connections
 */
export async function closeDatabaseConnection(): Promise<void> {
  console.log('Closing database connections...');
  try {
    await pool.end();
    console.log('Database connections closed successfully');
  } catch (error) {
    console.error('Error closing database connections:', error);
    throw error;
  }
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Starting graceful shutdown...`);
    try {
      await closeDatabaseConnection();
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Initialize database connection and run setup
 */
export async function initializeDatabase(): Promise<void> {
  console.log('Initializing database connection...');

  // Test connection
  const isHealthy = await checkDatabaseHealth();
  if (!isHealthy) {
    throw new Error('Failed to connect to database');
  }

  console.log('Database connection established successfully');

  // Enable pgvector extension if not already enabled
  try {
    const client = await pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('pgvector extension enabled');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Warning: Could not enable pgvector extension:', error);
    // Don't throw - the extension might already exist or require superuser privileges
  }

  // Setup graceful shutdown
  setupGracefulShutdown();
}
