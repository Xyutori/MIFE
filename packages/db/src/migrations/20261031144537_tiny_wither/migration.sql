CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE TABLE "anime_episode_sources" (
	"id" text PRIMARY KEY,
	"episode_id" text NOT NULL,
	"anime_source_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text,
	"stream_links_json" jsonb DEFAULT '[]' NOT NULL,
	"download_links_json" jsonb DEFAULT '[]' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_episodes" (
	"id" text PRIMARY KEY,
	"anime_id" text NOT NULL,
	"normalized_number" text NOT NULL,
	"number_text" text NOT NULL,
	"sort_number" real,
	"title" text,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_series" (
	"id" text PRIMARY KEY,
	"normalized_title" text NOT NULL,
	"title" text NOT NULL,
	"alternative_title" text,
	"synopsis" text,
	"status" text,
	"release_year" integer,
	"score" real,
	"episode_count" integer,
	"anime_type" text,
	"studio" text,
	"genres_json" jsonb DEFAULT '[]' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}' NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"latest_episode_number" text,
	"latest_episode_at" timestamp with time zone,
	"search_vector" tsvector,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_series_genres" (
	"anime_id" text NOT NULL,
	"genre_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_sources" (
	"id" text PRIMARY KEY,
	"anime_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"slug" text,
	"source_url" text,
	"title" text NOT NULL,
	"alternative_title" text,
	"poster_url" text,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_thumbnails" (
	"id" text PRIMARY KEY,
	"anime_source_id" text NOT NULL,
	"external_url" text NOT NULL,
	"blob_sha256" text,
	"download_status" text DEFAULT 'remote' NOT NULL,
	"last_error" text,
	"downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anime_bookmark_entries" (
	"id" text PRIMARY KEY,
	"group_id" text NOT NULL,
	"anime_id" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmark_groups" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"media_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"normalized_name" text NOT NULL,
	"default_key" text,
	"custom_cover_url" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmark_groups_media_type_check" CHECK ("media_type" in ('comic', 'anime'))
);
--> statement-breakpoint
CREATE TABLE "comic_bookmark_entries" (
	"id" text PRIMARY KEY,
	"group_id" text NOT NULL,
	"series_id" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_pages" (
	"id" text PRIMARY KEY,
	"chapter_source_id" text NOT NULL,
	"page_index" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"external_url" text NOT NULL,
	"blob_sha256" text,
	"download_status" text DEFAULT 'remote' NOT NULL,
	"download_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_sources" (
	"id" text PRIMARY KEY,
	"chapter_id" text NOT NULL,
	"series_source_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"slug" text,
	"source_url" text,
	"title" text,
	"thumbnail_url" text,
	"reader_url_status" text DEFAULT 'pending' NOT NULL,
	"reader_url_count" integer DEFAULT 0 NOT NULL,
	"reader_urls_scraped_at" timestamp with time zone,
	"reader_url_error" text,
	"published_at" timestamp with time zone,
	"view_count" integer,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_sources_reader_url_status_check" CHECK ("reader_url_status" in ('pending', 'running', 'complete', 'complete_empty', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" text PRIMARY KEY,
	"series_id" text NOT NULL,
	"normalized_number" text NOT NULL,
	"number_text" text NOT NULL,
	"sort_number" real,
	"title" text,
	"published_at" timestamp with time zone,
	"view_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_blobs" (
	"sha256" text PRIMARY KEY,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_variants" (
	"id" text PRIMARY KEY,
	"blob_sha256" text NOT NULL,
	"format" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY,
	"asset_type" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"source_id" text,
	"page_index" integer,
	"external_url" text NOT NULL,
	"blob_sha256" text,
	"download_status" text DEFAULT 'remote' NOT NULL,
	"integrity_status" text DEFAULT 'unchecked' NOT NULL,
	"sha256" text,
	"content_type" text,
	"byte_size" integer,
	"download_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"downloaded_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_events" (
	"id" text PRIMARY KEY,
	"run_id" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"details_json" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"source_id" text,
	"kind" text NOT NULL,
	"mode" text DEFAULT 'incremental' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"job_key" text,
	"worker_token" text,
	"worker_lease_expires_at" timestamp with time zone,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"progress_completed" integer DEFAULT 0 NOT NULL,
	"progress_failed" integer DEFAULT 0 NOT NULL,
	"current_step" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"summary_json" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"alternative_title" text,
	"description" text,
	"cover_image_url" text,
	"status" text,
	"release_year" integer,
	"authors_json" jsonb DEFAULT '[]' NOT NULL,
	"artists_json" jsonb DEFAULT '[]' NOT NULL,
	"genres_json" jsonb DEFAULT '[]' NOT NULL,
	"formats_json" jsonb DEFAULT '[]' NOT NULL,
	"comic_type" text,
	"country_id" text,
	"view_count" integer,
	"rating" real,
	"bookmark_count" integer,
	"popularity_rank" integer,
	"is_featured" boolean,
	"is_recommended" boolean,
	"is_visible" boolean DEFAULT true NOT NULL,
	"latest_chapter_number" text,
	"latest_chapter_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"search_vector" tsvector,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_aliases" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"series_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_genres" (
	"series_id" text NOT NULL,
	"genre_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_sources" (
	"id" text PRIMARY KEY,
	"series_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"category" text,
	"slug" text,
	"source_url" text,
	"title" text NOT NULL,
	"alternative_title" text,
	"banner_url" text,
	"source_updated_at" timestamp with time zone,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"last_hydrated_at" timestamp with time zone,
	"needs_hydration" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_scrape_state" (
	"id" text PRIMARY KEY,
	"source_id" text NOT NULL,
	"last_full_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_auto_scrape_date" text,
	"cursor_json" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"request_delay_ms" integer DEFAULT 700 NOT NULL,
	"config_json" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_permissions" (
	"key" text PRIMARY KEY,
	"label" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_role_permissions" (
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_roles" (
	"key" text PRIMARY KEY,
	"label" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rbac_user_roles" (
	"user_id" text NOT NULL,
	"role_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_media" (
	"id" text PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"media_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_media_type_check" CHECK ("media_type" in ('profile_avatar', 'profile_header', 'bookmark_group_cover'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "anime_episode_sources_source_external_unique" ON "anime_episode_sources" ("source_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_episode_sources_anime_source_episode_unique" ON "anime_episode_sources" ("anime_source_id","episode_id");--> statement-breakpoint
CREATE INDEX "anime_episode_sources_episode_idx" ON "anime_episode_sources" ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_episodes_anime_number_unique" ON "anime_episodes" ("anime_id","normalized_number");--> statement-breakpoint
CREATE INDEX "anime_episodes_anime_recent_v2_idx" ON "anime_episodes" ("anime_id","sort_number","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_series_normalized_title_unique" ON "anime_series" ("normalized_title");--> statement-breakpoint
CREATE INDEX "anime_series_latest_v2_idx" ON "anime_series" ("is_visible","latest_episode_at","updated_at");--> statement-breakpoint
CREATE INDEX "anime_series_title_v2_idx" ON "anime_series" ("is_visible","title","updated_at");--> statement-breakpoint
CREATE INDEX "anime_series_public_search_v2_idx" ON "anime_series" ("is_visible","normalized_title");--> statement-breakpoint
CREATE INDEX "anime_series_search_vector_idx" ON "anime_series" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_series_genres_anime_genre_unique" ON "anime_series_genres" ("anime_id","genre_key");--> statement-breakpoint
CREATE INDEX "anime_series_genres_lookup_idx" ON "anime_series_genres" ("genre_key","anime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_sources_source_external_unique" ON "anime_sources" ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "anime_sources_anime_idx" ON "anime_sources" ("anime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_thumbnails_source_url_unique" ON "anime_thumbnails" ("anime_source_id","external_url");--> statement-breakpoint
CREATE INDEX "anime_thumbnails_status_idx" ON "anime_thumbnails" ("download_status");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_bookmark_entries_group_anime_unique" ON "anime_bookmark_entries" ("group_id","anime_id");--> statement-breakpoint
CREATE INDEX "anime_bookmark_entries_group_order_idx" ON "anime_bookmark_entries" ("group_id","order_index","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmark_groups_owner_type_name_unique" ON "bookmark_groups" ("user_id","media_type","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmark_groups_default_unique" ON "bookmark_groups" ("user_id","media_type","default_key");--> statement-breakpoint
CREATE INDEX "bookmark_groups_owner_type_order_idx" ON "bookmark_groups" ("user_id","media_type","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "comic_bookmark_entries_group_series_unique" ON "comic_bookmark_entries" ("group_id","series_id");--> statement-breakpoint
CREATE INDEX "comic_bookmark_entries_group_order_idx" ON "comic_bookmark_entries" ("group_id","order_index","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_pages_source_position_unique" ON "chapter_pages" ("chapter_source_id","page_index");--> statement-breakpoint
CREATE INDEX "chapter_pages_status_idx" ON "chapter_pages" ("download_status");--> statement-breakpoint
CREATE INDEX "chapter_pages_external_url_idx" ON "chapter_pages" ("external_url");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_sources_source_external_unique" ON "chapter_sources" ("source_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_sources_series_source_chapter_unique" ON "chapter_sources" ("series_source_id","chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_sources_chapter_idx" ON "chapter_sources" ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_sources_release_idx" ON "chapter_sources" ("published_at");--> statement-breakpoint
CREATE INDEX "chapter_sources_reader_url_status_idx" ON "chapter_sources" ("source_id","reader_url_status");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_series_number_unique" ON "chapters" ("series_id","normalized_number");--> statement-breakpoint
CREATE INDEX "chapters_series_number_idx" ON "chapters" ("series_id","sort_number");--> statement-breakpoint
CREATE INDEX "chapters_series_recent_v2_idx" ON "chapters" ("series_id","sort_number","published_at","updated_at");--> statement-breakpoint
CREATE INDEX "chapters_series_number_search_v2_idx" ON "chapters" ("series_id",lower("number_text"));--> statement-breakpoint
CREATE INDEX "chapters_published_idx" ON "chapters" ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "image_blobs_object_key_unique" ON "image_blobs" ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "image_variants_blob_format_unique" ON "image_variants" ("blob_sha256","format");--> statement-breakpoint
CREATE UNIQUE INDEX "image_variants_object_key_unique" ON "image_variants" ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_owner_unique" ON "media_assets" ("asset_type","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "media_assets_status_idx" ON "media_assets" ("download_status","integrity_status");--> statement-breakpoint
CREATE INDEX "media_assets_source_idx" ON "media_assets" ("source_id");--> statement-breakpoint
CREATE INDEX "media_assets_external_url_idx" ON "media_assets" ("external_url");--> statement-breakpoint
CREATE INDEX "scrape_events_run_created_idx" ON "scrape_events" ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_workspace_created_idx" ON "scrape_runs" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "scrape_runs_status_idx" ON "scrape_runs" ("status");--> statement-breakpoint
CREATE INDEX "scrape_runs_source_kind_idx" ON "scrape_runs" ("source_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "scrape_runs_job_key_unique" ON "scrape_runs" ("job_key");--> statement-breakpoint
CREATE UNIQUE INDEX "series_workspace_title_unique" ON "series" ("workspace_id","normalized_title");--> statement-breakpoint
CREATE INDEX "series_workspace_updated_idx" ON "series" ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "series_title_idx" ON "series" ("title");--> statement-breakpoint
CREATE INDEX "series_catalog_recent_v2_idx" ON "series" ("workspace_id","is_visible","latest_chapter_at","updated_at");--> statement-breakpoint
CREATE INDEX "series_catalog_title_v2_idx" ON "series" ("workspace_id","is_visible","title","updated_at");--> statement-breakpoint
CREATE INDEX "series_catalog_recent_v3_idx" ON "series" ("workspace_id","is_visible","latest_chapter_at","updated_at");--> statement-breakpoint
CREATE INDEX "series_catalog_title_v3_idx" ON "series" ("workspace_id","is_visible","title","updated_at");--> statement-breakpoint
CREATE INDEX "series_public_country_v2_idx" ON "series" ("workspace_id","is_visible",lower("country_id"));--> statement-breakpoint
CREATE INDEX "series_public_type_v2_idx" ON "series" ("workspace_id","is_visible",lower("comic_type"));--> statement-breakpoint
CREATE INDEX "series_search_vector_idx" ON "series" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "series_aliases_workspace_alias_unique" ON "series_aliases" ("workspace_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "series_aliases_series_idx" ON "series_aliases" ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_genres_series_genre_unique" ON "series_genres" ("series_id","genre_key");--> statement-breakpoint
CREATE INDEX "series_genres_lookup_idx" ON "series_genres" ("genre_key","series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_sources_source_external_unique" ON "series_sources" ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "series_sources_series_idx" ON "series_sources" ("series_id");--> statement-breakpoint
CREATE INDEX "series_sources_source_updated_idx" ON "series_sources" ("source_id","source_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_scrape_state_source_unique" ON "source_scrape_state" ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_workspace_key_unique" ON "sources" ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "sources_workspace_idx" ON "sources" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_owner_key_unique" ON "user_preferences" ("user_id","key");--> statement-breakpoint
CREATE INDEX "user_preferences_owner_idx" ON "user_preferences" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rbac_permissions_label_unique" ON "rbac_permissions" ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "rbac_role_permissions_unique" ON "rbac_role_permissions" ("role_key","permission_key");--> statement-breakpoint
CREATE INDEX "rbac_role_permissions_permission_idx" ON "rbac_role_permissions" ("permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rbac_roles_label_unique" ON "rbac_roles" ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "rbac_user_roles_unique" ON "rbac_user_roles" ("user_id","role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rbac_user_roles_single_role_idx" ON "rbac_user_roles" ("user_id");--> statement-breakpoint
CREATE INDEX "rbac_user_roles_role_idx" ON "rbac_user_roles" ("role_key","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_media_owner_type_owner_unique" ON "user_media" ("owner_user_id","media_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_media_object_key_unique" ON "user_media" ("object_key");--> statement-breakpoint
CREATE INDEX "user_media_type_created_idx" ON "user_media" ("media_type","created_at");--> statement-breakpoint
CREATE INDEX "user_media_owner_idx" ON "user_media" ("owner_user_id","media_type");--> statement-breakpoint
ALTER TABLE "anime_episode_sources" ADD CONSTRAINT "anime_episode_sources_episode_id_anime_episodes_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "anime_episodes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_episode_sources" ADD CONSTRAINT "anime_episode_sources_anime_source_id_anime_sources_id_fkey" FOREIGN KEY ("anime_source_id") REFERENCES "anime_sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_episode_sources" ADD CONSTRAINT "anime_episode_sources_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_episodes" ADD CONSTRAINT "anime_episodes_anime_id_anime_series_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "anime_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_series_genres" ADD CONSTRAINT "anime_series_genres_anime_id_anime_series_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "anime_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_sources" ADD CONSTRAINT "anime_sources_anime_id_anime_series_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "anime_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_sources" ADD CONSTRAINT "anime_sources_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_thumbnails" ADD CONSTRAINT "anime_thumbnails_anime_source_id_anime_sources_id_fkey" FOREIGN KEY ("anime_source_id") REFERENCES "anime_sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_thumbnails" ADD CONSTRAINT "anime_thumbnails_blob_sha256_image_blobs_sha256_fkey" FOREIGN KEY ("blob_sha256") REFERENCES "image_blobs"("sha256") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_bookmark_entries" ADD CONSTRAINT "anime_bookmark_entries_group_id_bookmark_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bookmark_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anime_bookmark_entries" ADD CONSTRAINT "anime_bookmark_entries_anime_id_anime_series_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "anime_series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comic_bookmark_entries" ADD CONSTRAINT "comic_bookmark_entries_group_id_bookmark_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "bookmark_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comic_bookmark_entries" ADD CONSTRAINT "comic_bookmark_entries_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD CONSTRAINT "chapter_pages_chapter_source_id_chapter_sources_id_fkey" FOREIGN KEY ("chapter_source_id") REFERENCES "chapter_sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chapter_pages" ADD CONSTRAINT "chapter_pages_blob_sha256_image_blobs_sha256_fkey" FOREIGN KEY ("blob_sha256") REFERENCES "image_blobs"("sha256") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chapter_sources" ADD CONSTRAINT "chapter_sources_chapter_id_chapters_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chapter_sources" ADD CONSTRAINT "chapter_sources_series_source_id_series_sources_id_fkey" FOREIGN KEY ("series_source_id") REFERENCES "series_sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chapter_sources" ADD CONSTRAINT "chapter_sources_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "image_variants" ADD CONSTRAINT "image_variants_blob_sha256_image_blobs_sha256_fkey" FOREIGN KEY ("blob_sha256") REFERENCES "image_blobs"("sha256") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_blob_sha256_image_blobs_sha256_fkey" FOREIGN KEY ("blob_sha256") REFERENCES "image_blobs"("sha256") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "scrape_events" ADD CONSTRAINT "scrape_events_run_id_scrape_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scrape_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "series_aliases" ADD CONSTRAINT "series_aliases_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "series_aliases" ADD CONSTRAINT "series_aliases_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "series_genres" ADD CONSTRAINT "series_genres_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "series_sources" ADD CONSTRAINT "series_sources_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "series_sources" ADD CONSTRAINT "series_sources_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_scrape_state" ADD CONSTRAINT "source_scrape_state_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_role_key_rbac_roles_key_fkey" FOREIGN KEY ("role_key") REFERENCES "rbac_roles"("key") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_permission_key_rbac_permissions_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "rbac_permissions"("key") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_role_key_rbac_roles_key_fkey" FOREIGN KEY ("role_key") REFERENCES "rbac_roles"("key") ON DELETE CASCADE;