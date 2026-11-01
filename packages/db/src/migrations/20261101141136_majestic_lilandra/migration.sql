CREATE TABLE "comment_reports" (
	"id" text PRIMARY KEY,
	"comment_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reports_status_check" CHECK ("status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"author_id" text NOT NULL,
	"parent_id" text,
	"root_id" text,
	"reply_to_comment_id" text,
	"reply_to_user_id" text,
	"content_json" jsonb NOT NULL,
	"plain_text" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"has_spoiler" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_target_type_check" CHECK ("target_type" in ('comic_chapter', 'anime_episode')),
	CONSTRAINT "comments_status_check" CHECK ("status" in ('active', 'hidden', 'deleted')),
	CONSTRAINT "comments_word_count_check" CHECK ("word_count" >= 0 AND "word_count" <= 1000)
);
--> statement-breakpoint
CREATE INDEX "comment_reports_comment_created_idx" ON "comment_reports" ("comment_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_target_created_idx" ON "comments" ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_created_idx" ON "comments" ("parent_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_author_created_idx" ON "comments" ("author_id","created_at");--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;