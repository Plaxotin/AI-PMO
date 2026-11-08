CREATE TABLE `outcome_measurements` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`taskId` varchar(64) NOT NULL,
	`decisionId` varchar(64) NOT NULL,
	`metric` varchar(64) NOT NULL,
	`unit` varchar(24) NOT NULL,
	`baselineValue` varchar(32) NULL,
	`targetValue` varchar(32) NULL,
	`actualValue` varchar(32) NULL,
	`source` text NOT NULL,
	`sourceId` varchar(255) NOT NULL,
	`sourceUrl` text NULL,
	`status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'confirmed',
	`version` int unsigned NOT NULL DEFAULT 1,
	`previousVersionId` bigint unsigned NULL,
	`recordedByUserId` bigint unsigned NOT NULL,
	`recordedByName` varchar(255) NOT NULL,
	`recordedByRole` varchar(24) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outcome_measurements_task_metric_version_unique` UNIQUE(`taskId`,`metric`,`version`)
);
--> statement-breakpoint
CREATE INDEX `outcome_measurements_decision_idx` ON `outcome_measurements` (`decisionId`);
--> statement-breakpoint
CREATE INDEX `outcome_measurements_project_idx` ON `outcome_measurements` (`projectId`);
