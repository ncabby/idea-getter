import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { settings } from './schema.js';

const { Pool } = pg;

/**
 * Default monitored subreddits for the Idea Getter MVP
 * These are startup/indie hacker focused communities where users
 * frequently discuss pain points and product opportunities.
 */
const MONITORED_SUBREDDITS = [
  'r/indiehackers',
  'r/SaaS',
  'r/startups',
  'r/Entrepreneur',
  'r/smallbusiness',
  'r/sideproject',
  'r/microsaas',
  'r/advancedentrepreneur',
  'r/EntrepreneurRideAlong',
  'r/webdev',
  'r/programming',
  'r/selfhosted',
  'r/ProductManagement',
];

/**
 * Default settings for the Idea Getter system
 */
const DEFAULT_SETTINGS = [
  {
    key: 'min_score_threshold',
    value: 70,
    description: 'Minimum opportunity score threshold (0-100). Opportunities below this score are not shown in the dashboard.',
  },
  {
    key: 'min_complaint_count',
    value: 10,
    description: 'Minimum number of complaints required for a cluster to become an opportunity.',
  },
  {
    key: 'monitored_subreddits',
    value: MONITORED_SUBREDDITS,
    description: 'List of subreddits to monitor for user complaints and pain points.',
  },
  {
    key: 'similarity_threshold',
    value: 0.75,
    description: 'Cosine similarity threshold for clustering complaints (0-1). Higher values require more similar complaints.',
  },
  {
    key: 'data_retention_days',
    value: 30,
    description: 'Number of days to retain complaint data. Older data is archived.',
  },
  {
    key: 'scrape_lookback_days',
    value: 7,
    description: 'Number of days to look back when scraping new content from Reddit.',
  },
  {
    key: 'max_items_per_subreddit',
    value: 100,
    description: 'Maximum number of items to scrape per subreddit per run.',
  },
  {
    key: 'embedding_batch_size',
    value: 50,
    description: 'Number of complaints to process in a single embedding generation batch.',
  },
];

/**
 * Seed the settings table with default values
 */
async function seedSettings() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  console.log('Connecting to database...');
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    console.log('Seeding settings table...');

    for (const setting of DEFAULT_SETTINGS) {
      await db
        .insert(settings)
        .values({
          key: setting.key,
          value: setting.value,
          description: setting.description,
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: setting.value,
            description: setting.description,
            updatedAt: new Date(),
          },
        });
      console.log(`  ✓ Set ${setting.key}`);
    }

    console.log('\nSettings seeded successfully!');
    console.log('\nDefault configuration:');
    console.log(`  - Minimum score threshold: 70`);
    console.log(`  - Minimum complaint count: 10`);
    console.log(`  - Similarity threshold: 0.75`);
    console.log(`  - Data retention: 30 days`);
    console.log(`  - Monitored subreddits: ${MONITORED_SUBREDDITS.length}`);
    MONITORED_SUBREDDITS.forEach((sub) => console.log(`    - ${sub}`));
  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run seeding if this file is executed directly
seedSettings().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
