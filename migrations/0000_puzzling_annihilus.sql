CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"complaint_count" integer DEFAULT 0 NOT NULL,
	"platform_distribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"centroid_embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_platform" varchar(50) DEFAULT 'reddit' NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"source_url" text NOT NULL,
	"subreddit" varchar(100) NOT NULL,
	"author" varchar(100) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"embedding" vector(1536),
	"is_complaint" boolean DEFAULT false NOT NULL,
	"cluster_id" uuid
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"scoring_factors" jsonb DEFAULT '{"complaintCount":0,"daysActive":0,"growthPercentage":0,"workaroundCount":0,"platformCount":0}'::jsonb NOT NULL,
	"representative_quote_id" uuid,
	"is_bookmarked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_cluster_id_unique" UNIQUE("cluster_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "system_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"run_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_completed_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_representative_quote_id_complaints_id_fk" FOREIGN KEY ("representative_quote_id") REFERENCES "public"."complaints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clusters_last_seen_idx" ON "clusters" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "clusters_complaint_count_idx" ON "clusters" USING btree ("complaint_count");--> statement-breakpoint
CREATE INDEX "complaints_created_at_idx" ON "complaints" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "complaints_cluster_id_idx" ON "complaints" USING btree ("cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_source_unique_idx" ON "complaints" USING btree ("source_platform","source_id");--> statement-breakpoint
CREATE INDEX "complaints_is_complaint_idx" ON "complaints" USING btree ("is_complaint");--> statement-breakpoint
CREATE INDEX "opportunities_score_idx" ON "opportunities" USING btree ("score");--> statement-breakpoint
CREATE INDEX "opportunities_is_bookmarked_idx" ON "opportunities" USING btree ("is_bookmarked");--> statement-breakpoint
CREATE INDEX "opportunities_created_at_idx" ON "opportunities" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_unique_idx" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "system_metadata_job_type_run_started_at_idx" ON "system_metadata" USING btree ("job_type","run_started_at");--> statement-breakpoint
CREATE INDEX "system_metadata_status_idx" ON "system_metadata" USING btree ("status");