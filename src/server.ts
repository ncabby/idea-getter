import 'dotenv/config';
import { initializeDatabase, checkDatabaseHealth, closeDatabaseConnection } from './modules/database/index.js';
import { createApp } from './modules/api/index.js';
import { startScheduler, stopScheduler, getScheduler } from './modules/scheduler/index.js';

const PORT = process.env.PORT || 3000;
const SCHEDULER_ENABLED = process.env.SCHEDULER_ENABLED !== 'false';

/**
 * Application entry point
 *
 * Starts the Express server with dashboard views and API endpoints.
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

    console.log('Database module initialized successfully');

    // Start the job scheduler (daily pipeline at 2 AM UTC)
    if (SCHEDULER_ENABLED) {
      await startScheduler({
        enabled: SCHEDULER_ENABLED,
        checkMissedRunsOnStartup: true,
      });
      console.log('Job scheduler started');
    } else {
      console.log('Job scheduler disabled (SCHEDULER_ENABLED=false)');
    }

    // Create Express app with API routes
    const app = createApp({
      enableCors: true,
      enableLogging: process.env.NODE_ENV !== 'test',
    });

    // Start HTTP server
    const server = app.listen(PORT, () => {
      console.log(`Idea Getter running on http://localhost:${PORT}`);
      console.log('\nDashboard:');
      console.log(`  http://localhost:${PORT}/                - Opportunities list`);
      console.log(`  http://localhost:${PORT}/opportunity/:id - Opportunity details`);
      console.log('\nAPI Endpoints:');
      console.log('  GET    /api/opportunities          - List opportunities');
      console.log('  GET    /api/opportunities/:id      - Get opportunity details');
      console.log('  POST   /api/opportunities/:id/bookmark - Toggle bookmark');
      console.log('  GET    /api/settings               - Get settings');
      console.log('  PUT    /api/settings               - Update settings');
      console.log('  GET    /api/status                 - Get system status');
      console.log('\nDatabase scripts:');
      console.log('  npm run db:generate  - Generate migrations from schema changes');
      console.log('  npm run db:migrate   - Run migrations and create vector indexes');
      console.log('  npm run db:seed      - Seed default settings');
      console.log('  npm run db:studio    - Open Drizzle Studio for database inspection');

      // Log scheduler status
      if (SCHEDULER_ENABLED) {
        const scheduler = getScheduler();
        const state = scheduler.getState();
        console.log('\nScheduler:');
        console.log(`  Status: ${state.isRunning ? 'Running' : 'Stopped'}`);
        console.log(`  Next run: ${state.nextRunTime?.toISOString() ?? 'Not scheduled'}`);
        console.log('  Schedule: Daily at 2:00 AM UTC');
      }
    });

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}. Shutting down gracefully...`);

      // Stop the scheduler first (cancels any running pipeline)
      await stopScheduler();
      console.log('Job scheduler stopped.');

      server.close(async () => {
        console.log('HTTP server closed.');
        await closeDatabaseConnection();
        console.log('Database connection closed.');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();
