ALTER TABLE "users" ADD COLUMN "shortcut_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_shortcut_token_unique" UNIQUE("shortcut_token");