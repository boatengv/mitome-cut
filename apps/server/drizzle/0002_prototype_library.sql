CREATE TYPE "public"."ai_purpose" AS ENUM('video', 'image', 'sketch', 'llm', 'tts');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" text,
	"purpose" "ai_purpose" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"message" text,
	"output" jsonb,
	"error" text,
	"provider_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"size_bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"path" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- v1 projects, assets and exports use the old timeline model and cannot be carried over.
DELETE FROM "exports";--> statement-breakpoint
ALTER TABLE "assets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "assets" CASCADE;--> statement-breakpoint
DROP TABLE "generations" CASCADE;--> statement-breakpoint
DROP TABLE "project_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "projects" CASCADE;--> statement-breakpoint
ALTER TABLE "exports" DROP CONSTRAINT IF EXISTS "exports_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "exports" DROP CONSTRAINT IF EXISTS "exports_output_asset_id_assets_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "exports_project_idx";--> statement-breakpoint
ALTER TABLE "exports" ALTER COLUMN "project_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "output_path" text;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_owner_day_idx" ON "ai_jobs" USING btree ("owner_id","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_owner_key_idx" ON "docs" USING btree ("owner_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "files_owner_path_ready_idx" ON "files" USING btree ("owner_id","path") WHERE "files"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "exports_owner_idx" ON "exports" USING btree ("owner_id","created_at");--> statement-breakpoint
ALTER TABLE "exports" DROP COLUMN "revision";--> statement-breakpoint
ALTER TABLE "exports" DROP COLUMN "output_asset_id";--> statement-breakpoint
DROP TYPE "public"."asset_kind";--> statement-breakpoint
DROP TYPE "public"."asset_source";--> statement-breakpoint
DROP TYPE "public"."asset_status";