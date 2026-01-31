# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Idea Getter is an AI-powered system that monitors Reddit discussions to identify persistent user pain points and surface product opportunities. It uses vector embeddings and semantic clustering to group similar complaints and score them as opportunities.

## Build & Development Commands

```bash
npm run build           # Compile TypeScript to dist/
npm run dev             # Development mode with hot-reload (tsx watch)
npm run typecheck       # Type check without emitting

# Database operations
npm run db:generate     # Generate migrations from schema changes
npm run db:migrate      # Run migrations + create HNSW vector indexes
npm run db:seed         # Initialize default settings (subreddits, thresholds)
npm run db:studio       # Open Drizzle Studio for database inspection
```

## Architecture

### Module Structure
```
src/
├── modules/
│   └── database/       # Database layer (fully implemented)
│       ├── schema.ts   # Drizzle table definitions with pgvector
│       ├── client.ts   # Connection pool & lifecycle management
│       ├── queries.ts  # Type-safe query builders
│       ├── migrate.ts  # Migration runner + HNSW index creation
│       └── seed.ts     # Default settings initialization
├── shared/             # Shared utilities/types (empty, reserved)
└── server.ts           # Application entry point
```

### Database Schema
Five core tables with relationships:
- **complaints** → Raw Reddit content with 1536-dim vector embeddings
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
- `monitored_subreddits: [13 subreddits]`
- `similarity_threshold: 0.75`

### Environment Variables
Required: `DATABASE_URL` (PostgreSQL connection string with pgvector extension)
Optional: `PORT`, `NODE_ENV`, individual DB params (DB_HOST, DB_PORT, etc.)

## TypeScript Configuration

Strict mode enabled with ESM modules (NodeNext). All source in `src/`, compiled output in `dist/`.
