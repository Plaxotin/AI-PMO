CREATE TABLE `telegram_onboardings` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`channelId` varchar(64) NOT NULL,
	`connectedAt` timestamp NOT NULL,
	`firstDigestDueAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_onboardings_project_unique` UNIQUE(`projectId`)
);
--> statement-breakpoint
CREATE INDEX `telegram_onboardings_first_digest_idx` ON `telegram_onboardings` (`firstDigestDueAt`);
--> statement-breakpoint
CREATE TABLE `telegram_digest_deliveries` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`kind` enum('welcome','first','daily','founder') NOT NULL,
	`periodKey` varchar(32) NOT NULL,
	`recipientRole` enum('rp','founder') NOT NULL,
	`chatId` varchar(64) NOT NULL DEFAULT '',
	`userId` varchar(64) NOT NULL DEFAULT '',
	`status` enum('sending','sent','failed','unknown') NOT NULL DEFAULT 'sending',
	`coverageStart` timestamp NULL,
	`coverageEnd` timestamp NULL,
	`messageId` bigint NULL,
	`error` text NULL,
	`sentAt` timestamp NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_digest_recipient_unique` UNIQUE(`projectId`,`kind`,`periodKey`,`recipientRole`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `telegram_digest_status_idx` ON `telegram_digest_deliveries` (`status`,`createdAt`);
