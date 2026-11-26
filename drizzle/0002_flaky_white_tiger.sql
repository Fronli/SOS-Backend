CREATE TYPE "public"."account_status_enum" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."assignment_request_kind_enum" AS ENUM('COMPLETION', 'CANCELLATION');--> statement-breakpoint
CREATE TYPE "public"."assignment_request_status_enum" AS ENUM('PENDING', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."assignment_status_enum" AS ENUM('PENDING_AGREEMENT', 'ON_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."conversation_status_enum" AS ENUM('ACTIVE', 'DECLINED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."dispute_decision_enum" AS ENUM('FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE');--> statement-breakpoint
CREATE TYPE "public"."dispute_status_enum" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."file_purpose_enum" AS ENUM('AVATAR', 'PORTFOLIO', 'STUDENT_ID', 'REQUEST_ATTACHMENT', 'CHAT_ATTACHMENT', 'DISPUTE_EVIDENCE');--> statement-breakpoint
CREATE TYPE "public"."file_status_enum" AS ENUM('PENDING', 'UPLOADED');--> statement-breakpoint
CREATE TYPE "public"."report_status_enum" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."report_target_type_enum" AS ENUM('REQUEST', 'USER');--> statement-breakpoint
CREATE TYPE "public"."request_status_enum" AS ENUM('OPEN', 'CANCELLED', 'COMPLETED', 'HIDDEN', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."student_verification_status_enum" AS ENUM('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."user_role_enum" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."wallet_transaction_status_enum" AS ENUM('PENDING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."wallet_transaction_type_enum" AS ENUM('TOPUP', 'WITHDRAWAL', 'HOLD', 'RELEASE', 'REFUND', 'FEE', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "assignment_request_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"kind" "assignment_request_kind_enum" NOT NULL,
	"requested_by" integer NOT NULL,
	"reason" text,
	"status" "assignment_request_status_enum" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer
);
--> statement-breakpoint
CREATE TABLE "assignment_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"requester_id" integer NOT NULL,
	"helper_id" integer NOT NULL,
	"status" "assignment_status_enum" DEFAULT 'PENDING_AGREEMENT' NOT NULL,
	"amount" integer NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"terms" text NOT NULL,
	"requester_approved_at" timestamp with time zone,
	"helper_approved_at" timestamp with time zone,
	"funded_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_amount_nonnegative" CHECK ("assignment_table"."amount" >= 0),
	CONSTRAINT "assignment_participants_differ" CHECK ("assignment_table"."requester_id" <> "assignment_table"."helper_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_account_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bank_code" varchar(20) NOT NULL,
	"account_number_masked" varchar(40) NOT NULL,
	"account_name" varchar(255) NOT NULL,
	"provider_token" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "block_table" (
	"blocker_id" integer NOT NULL,
	"blocked_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_table_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "block_self_forbidden" CHECK ("block_table"."blocker_id" <> "block_table"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_read_table" (
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_message_id" integer,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_read_table_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"requester_id" integer NOT NULL,
	"helper_id" integer NOT NULL,
	"status" "conversation_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_differ" CHECK ("conversation_table"."requester_id" <> "conversation_table"."helper_id")
);
--> statement-breakpoint
CREATE TABLE "device_token_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(255) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_token_table_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence_table" (
	"dispute_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	CONSTRAINT "dispute_evidence_table_dispute_id_file_id_pk" PRIMARY KEY("dispute_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "dispute_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"raised_by" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status_enum" DEFAULT 'OPEN' NOT NULL,
	"decision" "dispute_decision_enum",
	"refund_amount" integer,
	"basis" text,
	"claimed_by" integer,
	"claimed_at" timestamp with time zone,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_refund_nonnegative" CHECK ("dispute_table"."refund_amount" IS NULL OR "dispute_table"."refund_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"key" varchar(128) NOT NULL,
	"purpose" "file_purpose_enum" NOT NULL,
	"mime" varchar(128) NOT NULL,
	"byte_size" integer NOT NULL,
	"original_name" varchar(255),
	"status" "file_status_enum" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_table_key_unique" UNIQUE("key"),
	CONSTRAINT "file_byte_size_positive" CHECK ("file_table"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "message_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"body" text,
	"file_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_content_present" CHECK ("message_table"."body" IS NOT NULL OR "message_table"."file_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notification_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(150) NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_otp_table" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"otp_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(150) NOT NULL,
	"description" text,
	"url" varchar(255),
	"file_key" varchar(128),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_token_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" integer,
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_table_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "reply_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"helper_id" integer NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reply_message_length" CHECK (char_length(btrim("reply_table"."message")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "report_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" integer NOT NULL,
	"target_type" "report_target_type_enum" NOT NULL,
	"target_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status_enum" DEFAULT 'OPEN' NOT NULL,
	"claimed_by" integer,
	"claimed_at" timestamp with time zone,
	"resolution_action" varchar(40),
	"resolution_reason" text,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_attachment_table" (
	"request_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	CONSTRAINT "request_attachment_table_request_id_file_id_pk" PRIMARY KEY("request_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "review_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"requester_id" integer NOT NULL,
	"helper_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_table_assignment_id_unique" UNIQUE("assignment_id"),
	CONSTRAINT "review_rating_range" CHECK ("review_table"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "student_verification_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"file_key" varchar(128) NOT NULL,
	"status" "student_verification_status_enum" DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"reviewer_id" integer,
	"claimed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_interest_table" (
	"user_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "user_interest_table_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "user_skill_table" (
	"user_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "user_skill_table_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_table" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"held" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_balance_nonnegative" CHECK ("wallet_table"."balance" >= 0),
	CONSTRAINT "wallet_held_nonnegative" CHECK ("wallet_table"."held" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_transaction_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "wallet_transaction_type_enum" NOT NULL,
	"status" "wallet_transaction_status_enum" DEFAULT 'SUCCESS' NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"held_after" bigint NOT NULL,
	"reference_type" varchar(40) NOT NULL,
	"reference_id" integer,
	"note" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_table" ADD COLUMN "status" "request_status_enum" DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_table" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_table" ADD COLUMN "hidden_by" integer;--> statement-breakpoint
ALTER TABLE "request_table" ADD COLUMN "moderation_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "request_table" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_table" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "role" "user_role_enum" DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "status" "account_status_enum" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "suspended_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "student_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "avatar_file_key" varchar(128);--> statement-breakpoint
ALTER TABLE "user_table" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignment_request_table" ADD CONSTRAINT "assignment_request_table_assignment_id_assignment_table_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_request_table" ADD CONSTRAINT "assignment_request_table_requested_by_user_table_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_request_table" ADD CONSTRAINT "assignment_request_table_resolved_by_user_table_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_table" ADD CONSTRAINT "assignment_table_request_id_request_table_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_table" ADD CONSTRAINT "assignment_table_requester_id_user_table_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_table" ADD CONSTRAINT "assignment_table_helper_id_user_table_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."user_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_table" ADD CONSTRAINT "audit_log_table_actor_id_user_table_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_table" ADD CONSTRAINT "bank_account_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_table" ADD CONSTRAINT "block_table_blocker_id_user_table_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_table" ADD CONSTRAINT "block_table_blocked_id_user_table_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_table" ADD CONSTRAINT "conversation_read_table_conversation_id_conversation_table_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_table" ADD CONSTRAINT "conversation_read_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_table" ADD CONSTRAINT "conversation_table_request_id_request_table_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_table" ADD CONSTRAINT "conversation_table_requester_id_user_table_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_table" ADD CONSTRAINT "conversation_table_helper_id_user_table_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_token_table" ADD CONSTRAINT "device_token_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence_table" ADD CONSTRAINT "dispute_evidence_table_dispute_id_dispute_table_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."dispute_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence_table" ADD CONSTRAINT "dispute_evidence_table_file_id_file_table_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_table" ADD CONSTRAINT "dispute_table_assignment_id_assignment_table_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_table" ADD CONSTRAINT "dispute_table_raised_by_user_table_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."user_table"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_table" ADD CONSTRAINT "dispute_table_claimed_by_user_table_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_table" ADD CONSTRAINT "dispute_table_resolved_by_user_table_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_table" ADD CONSTRAINT "file_table_owner_id_user_table_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_table" ADD CONSTRAINT "message_table_conversation_id_conversation_table_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_table" ADD CONSTRAINT "message_table_sender_id_user_table_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_table" ADD CONSTRAINT "message_table_file_id_file_table_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_table" ADD CONSTRAINT "notification_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_otp_table" ADD CONSTRAINT "password_reset_otp_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_table" ADD CONSTRAINT "portfolio_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token_table" ADD CONSTRAINT "refresh_token_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_table" ADD CONSTRAINT "reply_table_request_id_request_table_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_table" ADD CONSTRAINT "reply_table_helper_id_user_table_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_table" ADD CONSTRAINT "report_table_reporter_id_user_table_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_table" ADD CONSTRAINT "report_table_claimed_by_user_table_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_table" ADD CONSTRAINT "report_table_resolved_by_user_table_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment_table" ADD CONSTRAINT "request_attachment_table_request_id_request_table_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment_table" ADD CONSTRAINT "request_attachment_table_file_id_file_table_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_table" ADD CONSTRAINT "review_table_assignment_id_assignment_table_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_table" ADD CONSTRAINT "review_table_requester_id_user_table_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_table" ADD CONSTRAINT "review_table_helper_id_user_table_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_verification_table" ADD CONSTRAINT "student_verification_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_verification_table" ADD CONSTRAINT "student_verification_table_reviewer_id_user_table_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interest_table" ADD CONSTRAINT "user_interest_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interest_table" ADD CONSTRAINT "user_interest_table_tag_id_tag_table_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_table" ADD CONSTRAINT "user_skill_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_table" ADD CONSTRAINT "user_skill_table_tag_id_tag_table_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_table" ADD CONSTRAINT "wallet_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transaction_table" ADD CONSTRAINT "wallet_transaction_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_request_pending_idx" ON "assignment_request_table" USING btree ("assignment_id","kind","status");--> statement-breakpoint
CREATE INDEX "assignment_request_idx" ON "assignment_table" USING btree ("request_id","status");--> statement-breakpoint
CREATE INDEX "assignment_requester_idx" ON "assignment_table" USING btree ("requester_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assignment_helper_idx" ON "assignment_table" USING btree ("helper_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log_table" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log_table" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bank_account_user_idx" ON "bank_account_table" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "block_blocked_idx" ON "block_table" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_request_helper_uniq" ON "conversation_table" USING btree ("request_id","helper_id");--> statement-breakpoint
CREATE INDEX "conversation_requester_idx" ON "conversation_table" USING btree ("requester_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_helper_idx" ON "conversation_table" USING btree ("helper_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_token_user_idx" ON "device_token_table" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dispute_status_idx" ON "dispute_table" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dispute_assignment_idx" ON "dispute_table" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "file_owner_idx" ON "file_table" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message_table" USING btree ("conversation_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification_table" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolio_owner_idx" ON "portfolio_table" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX "refresh_token_user_idx" ON "refresh_token_table" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_token_family_idx" ON "refresh_token_table" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "reply_request_idx" ON "reply_table" USING btree ("request_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report_table" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "report_table" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "report_reporter_idx" ON "report_table" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "review_helper_idx" ON "review_table" USING btree ("helper_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "student_verification_status_idx" ON "student_verification_table" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "student_verification_active_uniq" ON "student_verification_table" USING btree ("user_id") WHERE "student_verification_table"."status" IN ('PENDING', 'IN_REVIEW');--> statement-breakpoint
CREATE INDEX "user_interest_tag_idx" ON "user_interest_table" USING btree ("tag_id","user_id");--> statement-breakpoint
CREATE INDEX "user_skill_tag_idx" ON "user_skill_table" USING btree ("tag_id","user_id");--> statement-breakpoint
CREATE INDEX "wallet_transaction_user_idx" ON "wallet_transaction_table" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallet_transaction_ref_idx" ON "wallet_transaction_table" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "wallet_transaction_created_idx" ON "wallet_transaction_table" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "request_table" ADD CONSTRAINT "request_table_hidden_by_user_table_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."user_table"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_status_idx" ON "request_table" USING btree ("status","created_at" DESC NULLS LAST) WHERE "request_table"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "user_table" USING btree ("role");--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "user_table" USING btree ("status");