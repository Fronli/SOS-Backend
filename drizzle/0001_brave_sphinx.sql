CREATE TYPE "public"."estimated_time_enum" AS ENUM('fast', 'moderate', 'extended');--> statement-breakpoint
CREATE TABLE "request_helper_table" (
	"request_id" integer NOT NULL,
	"helper_id" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_helper_table_request_id_helper_id_pk" PRIMARY KEY("request_id","helper_id")
);
--> statement-breakpoint
CREATE TABLE "request_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"title" varchar(150) NOT NULL,
	"description" text NOT NULL,
	"estimated_time" "estimated_time_enum" NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"budget_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "request_budget_nonnegative" CHECK ("request_table"."budget_amount" >= 0),
	CONSTRAINT "request_title_length" CHECK (char_length(btrim("request_table"."title")) BETWEEN 5 AND 150),
	CONSTRAINT "request_description_length" CHECK (char_length(btrim("request_table"."description")) BETWEEN 10 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "request_tag_table" (
	"request_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "request_tag_table_request_id_tag_id_pk" PRIMARY KEY("request_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(80) NOT NULL,
	CONSTRAINT "tag_table_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "user_table" ALTER COLUMN "linkedin_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table" ALTER COLUMN "website" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "request_helper_table" ADD CONSTRAINT "request_helper_table_request_id_request_table_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_helper_table" ADD CONSTRAINT "request_helper_table_helper_id_user_table_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."user_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_table" ADD CONSTRAINT "request_table_requester_id_user_table_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_tag_table" ADD CONSTRAINT "request_tag_table_request_id_request_table_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_tag_table" ADD CONSTRAINT "request_tag_table_tag_id_tag_table_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_helper_reverse_idx" ON "request_helper_table" USING btree ("helper_id","request_id");--> statement-breakpoint
CREATE INDEX "request_feed_idx" ON "request_table" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "request_table"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "request_owner_idx" ON "request_table" USING btree ("requester_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "request_table"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "request_tag_reverse_idx" ON "request_tag_table" USING btree ("tag_id","request_id");