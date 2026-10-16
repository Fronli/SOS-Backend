CREATE TABLE "registration_otp_table" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"otp_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_table" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"email" text NOT NULL,
	"password" varchar(255) NOT NULL,
	"university" varchar(255) NOT NULL,
	"major" varchar(255) NOT NULL,
	"linkedin_url" varchar(255) NOT NULL,
	"website" varchar(255) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_table_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "registration_otp_table" ADD CONSTRAINT "registration_otp_table_user_id_user_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_table"("id") ON DELETE cascade ON UPDATE no action;