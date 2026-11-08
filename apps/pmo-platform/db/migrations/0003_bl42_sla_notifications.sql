CREATE TABLE `telegram_sla_notifications` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`objectType` enum('decision','task') NOT NULL,
	`objectId` varchar(64) NOT NULL,
	`objectVersion` varchar(64) NOT NULL,
	`step` enum('reminder','escalation') NOT NULL,
	`recipientRole` enum('rp','owner','sponsor') NOT NULL,
	`chatId` varchar(64) NOT NULL DEFAULT '',
	`userId` varchar(64) NOT NULL DEFAULT '',
	`status` enum('sending','sent','failed','unknown') NOT NULL DEFAULT 'sending',
	`messageId` bigint,
	`error` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_sla_object_step_recipient_unique` UNIQUE(`objectType`,`objectId`,`objectVersion`,`step`,`recipientRole`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `telegram_sla_status_idx` ON `telegram_sla_notifications` (`status`,`createdAt`);