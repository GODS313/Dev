CREATE TABLE `accounts` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`cash_usdt` real DEFAULT 10000 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`risk_percent` real DEFAULT 2 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`chat_id` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`average_price` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`chat_id`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`side` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`quote_amount` real NOT NULL,
	`mode` text DEFAULT 'paper' NOT NULL,
	`created_at` integer NOT NULL
);
