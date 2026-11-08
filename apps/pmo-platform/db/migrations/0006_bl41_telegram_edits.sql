CREATE TABLE `telegram_pending_edits` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`decisionId` varchar(64) NOT NULL,
	`chatId` varchar(64) NOT NULL,
	`userId` varchar(64) NOT NULL,
	`sourceVersion` int unsigned NOT NULL,
	`instruction` text NULL,
	`previewTitle` text NULL,
	`previewOwner` varchar(255) NULL,
	`previewDue` varchar(16) NULL,
	`status` enum('pending','processing','preview','cancelled','accepted') NOT NULL DEFAULT 'pending',
	`error` text NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_pending_edits_decision_user_unique` UNIQUE(`decisionId`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `telegram_pending_edits_chat_status_idx` ON `telegram_pending_edits` (`chatId`,`userId`,`status`);
