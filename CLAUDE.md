# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Idea Getter is an AI-powered system that monitors Hacker News discussions to identify persistent user pain points and surface product opportunities. It uses vector embeddings and semantic clustering to group similar complaints and score them as opportunities.

## Build & Development Commands

```bash
npm run build           # Compile TypeScript to dist/
npm run dev             # Development mode with hot-reload (tsx watch)
npm run typecheck       # Type check without emitting

# Database operations
npm run db:generate     # Generate migrations from schema changes
npm run db:migrate      # Run migrations + create HNSW vector indexes
npm run db:seed         # Initialize default settings (categories, thresholds)
npm run db:studio       # Open Drizzle Studio for database inspection
```

## Architecture

### Module Structure
```
src/
├── modules/
│   ├── database/       # Database layer (fully implemented)
│   │   ├── schema.ts   # Drizzle table definitions with pgvector
│   │   ├── client.ts   # Connection pool & lifecycle management
│   │   ├── queries.ts  # Type-safe query builders
│   │   ├── migrate.ts  # Migration runner + HNSW index creation
│   │   └── seed.ts     # Default settings initialization
│   ├── scraper/        # Hacker News scraping module
│   │   ├── types.ts    # Type definitions and config interfaces
│   │   ├── client.ts   # HN Firebase API client
│   │   ├── scraper.ts  # HackerNewsScraper class with scraping logic
│   │   └── index.ts    # Public API exports
│   └── intelligence/   # Intelligence engine module
│       ├── types.ts    # Type definitions for all components
│       ├── detector.ts # ComplaintDetector: pattern matching
│       ├── embeddings.ts # EmbeddingGenerator: OpenAI integration
│       ├── clustering.ts # ClusteringEngine: pgvector similarity
│       ├── scoring.ts  # ScoringEngine: multi-factor scoring
│       └── index.ts    # Public API exports + pipeline runner
├── shared/             # Shared utilities/types (empty, reserved)
└── server.ts           # Application entry point
```

### Database Schema
Five core tables with relationships:
- **complaints** → Raw HN content with 1536-dim vector embeddings
- **clusters** → Grouped similar complaints with centroid embedding
- **opportunities** → Scored clusters meeting threshold criteria (1:1 with clusters)
- **settings** → Key-value configuration store
- **system_metadata** → Job run tracking for pipeline monitoring

### Vector Similarity
Uses pgvector with HNSW indexes for efficient cosine similarity search:
- `findSimilarComplaints(embedding, threshold)` - Find similar complaints
- `findMostSimilarCluster(embedding, threshold)` - Match complaint to cluster
- Similarity threshold: 0.75 (configurable in settings)

## Key Patterns

### Database Queries
All queries are exported from `src/modules/database/index.ts`:
```typescript
import { insertComplaint, findSimilarComplaints, getSetting } from './modules/database/index.js';
```

### Configuration
Runtime settings stored in database, seeded defaults:
- `min_score_threshold: 70`
- `min_complaint_count: 10`
- `monitored_categories: ['ask', 'show']`
- `similarity_threshold: 0.75`
- `scrape_lookback_days: 30`
- `max_items_per_category: 100`

### Hacker News Scraper
Scrapes stories and comments from configured HN categories:
```typescript
import { HackerNewsScraper, scrapeAllCategories } from './modules/scraper/index.js';

// Simple usage - scrape all configured categories
const stats = await scrapeAllCategories();

// Custom configuration
const scraper = new HackerNewsScraper({
  lookbackDays: 30,          // How far back to look
  maxItemsPerCategory: 100,  // Max stories per category
  fetchComments: true,       // Also fetch top-level comments
  maxCommentsPerStory: 10,   // Max comments per story
});
const stats = await scraper.scrapeCategories(['ask', 'show']);
```
- Uses the open HN Firebase API (no authentication required)
- Implements rate limiting (~100ms between requests) and retry logic
- Deduplicates using `source_platform + source_id` unique constraint
- Logs job runs to `system_metadata` table (job_type: 'scraper')

### Intelligence Engine
Transforms scraped data into opportunities through a 4-stage pipeline:
```typescript
import { runIntelligencePipeline } from './modules/intelligence/index.js';

// Run the full pipeline
const result = await runIntelligencePipeline();

// Run individual stages
import { detectComplaints, generateEmbeddings, clusterComplaints, scoreClusters } from './modules/intelligence/index.js';

const detectionStats = await detectComplaints(100);    // Process 100 items
const embeddingStats = await generateEmbeddings(100);  // Generate embeddings
const clusteringStats = await clusterComplaints(100);  // Cluster complaints
const scoringStats = await scoreClusters();            // Score all clusters
```

**Pipeline Stages:**
1. **Detection**: Pattern matching for frustration language, failure descriptions, problem statements
2. **Embedding**: 1536-dim vectors via OpenAI text-embedding-ada-002 (batch of 50)
3. **Clustering**: pgvector cosine similarity with 0.75 threshold; Claude API for summaries
4. **Scoring**: Multi-factor algorithm: `score = min(100, complaint_count*2 + days_active*1 + growth*0.5 + workarounds*5 + platforms*3)`

**Key Classes:**
- `ComplaintDetector` - Detects complaints via regex patterns
- `EmbeddingGenerator` - OpenAI embeddings with retry/backoff
- `ClusteringEngine` - Similarity clustering with Claude summaries
- `ScoringEngine` - Multi-factor scoring with workaround detection

### Environment Variables
**Database (required):**
- `DATABASE_URL` - PostgreSQL connection string with pgvector extension

**Intelligence Engine (required for pipeline):**
- `OPENAI_API_KEY` - OpenAI API key for embedding generation
- `ANTHROPIC_API_KEY` - Anthropic API key for cluster summary generation

**Optional:**
- `PORT`, `NODE_ENV`, individual DB params (DB_HOST, DB_PORT, etc.)

Note: The Hacker News API requires no authentication - it's completely open!

## TypeScript Configuration

Strict mode enabled with ESM modules (NodeNext). All source in `src/`, compiled output in `dist/`.
