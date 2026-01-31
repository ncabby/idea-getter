import 'dotenv/config';
import { initializeDatabase, checkDatabaseHealth } from './modules/database/index.js';

const PORT = process.env.PORT || 3000;

/**
 * Application entry point
 *
 * This is a placeholder for the full application server.
 * The database module is complete and ready for use by other modules.
 */
async function main() {
  console.log('Starting Idea Getter...');

  try {
    // Initialize database connection
    await initializeDatabase();

    // Verify database is healthy
    const isHealthy = await checkDatabaseHealth();
    if (!isHealthy) {
      throw new Error('Database health check failed');
    }

    console.log(`Idea Getter is ready on port ${PORT}`);
    console.log('Database module initialized successfully');
    console.log('\nAvailable npm scripts:');
    console.log('  npm run db:generate  - Generate new migrations from schema changes');
    console.log('  npm run db:migrate   - Run migrations and create vector indexes');
    console.log('  npm run db:seed      - Seed default settings');
    console.log('  npm run db:studio    - Open Drizzle Studio for database inspection');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();
