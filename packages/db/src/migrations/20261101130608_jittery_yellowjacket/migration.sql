CREATE TABLE "content_visits" (
	"content_type" text,
	"content_id" text,
	"visitor_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_visits_pkey" PRIMARY KEY("content_type","content_id","visitor_key"),
	CONSTRAINT "content_visits_type_check" CHECK ("content_type" in ('comic', 'chapter', 'anime', 'episode'))
);
--> statement-breakpoint
ALTER TABLE "anime_episodes" ADD COLUMN "local_view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_series" ADD COLUMN "local_view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "local_view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "local_view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "content_visits_expires_at_idx" ON "content_visits" ("expires_at");