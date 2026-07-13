CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"room_type" text NOT NULL,
	"is_debug" boolean DEFAULT false NOT NULL,
	"max_players" integer NOT NULL,
	"host_id" text,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
