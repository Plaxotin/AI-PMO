CREATE TABLE `channels` (
  `id` varchar(64) PRIMARY KEY,
  `projectId` varchar(64) NOT NULL,
  `type` varchar(24) NOT NULL,
  `createdAt` timestamp DEFAULT (now()) NOT NULL
);--> statement-breakpoint
CREATE INDEX `channels_project_idx` ON `channels` (`projectId`);--> statement-breakpoint
CREATE TABLE `channel_external_ids` (
  `id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
  `projectId` varchar(64) NOT NULL,
  `channelId` varchar(64) NOT NULL,
  `externalId` varchar(64) NOT NULL,
  `status` enum('active', 'migrated') DEFAULT 'active' NOT NULL,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) NOT NULL,
  CONSTRAINT `channel_external_ids_external_unique` UNIQUE (`externalId`)
);--> statement-breakpoint
CREATE INDEX `channel_external_ids_channel_idx` ON `channel_external_ids` (`channelId`);--> statement-breakpoint
ALTER TABLE `signals`
  ADD `channelId` varchar(64);--> statement-breakpoint
CREATE INDEX `signals_channel_idx` ON `signals` (`channelId`);--> statement-breakpoint
INSERT INTO `channels` (`id`, `projectId`, `type`)
SELECT DISTINCT CONCAT('CH-TG-', `chatId`), `projectId`, 'telegram'
FROM `signals`;--> statement-breakpoint
INSERT INTO `channel_external_ids` (`projectId`, `channelId`, `externalId`, `status`)
SELECT DISTINCT `projectId`, CONCAT('CH-TG-', `chatId`), `chatId`, 'active'
FROM `signals`;--> statement-breakpoint
UPDATE `signals`
SET `channelId` = CONCAT('CH-TG-', `chatId`)
WHERE `channelId` IS NULL;
