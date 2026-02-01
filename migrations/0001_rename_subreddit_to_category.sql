-- Rename subreddit column to category
ALTER TABLE "complaints" RENAME COLUMN "subreddit" TO "category";

-- Update default platform from 'reddit' to 'hackernews'
ALTER TABLE "complaints" ALTER COLUMN "source_platform" SET DEFAULT 'hackernews';
