CREATE TABLE `outcome_sources` (
	`id` varchar(64) PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`type` varchar(32) NOT NULL,
	`name` varchar(255) NOT NULL,
	`connectionRef` varchar(128) NOT NULL,
	`readOnly` boolean NOT NULL DEFAULT true,
	`config` json NOT NULL,
	`status` enum('active','paused','error','disabled') NOT NULL DEFAULT 'active',
	`lastAttemptAt` timestamp NULL,
	`lastSuccessAt` timestamp NULL,
	`lastErrorCode` varchar(128) NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `outcome_sources_project_idx` ON `outcome_sources` (`projectId`);
--> statement-breakpoint
CREATE TABLE `outcome_metric_bindings` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`bindingKey` varchar(64) NOT NULL,
	`projectId` varchar(64) NOT NULL,
	`sourceId` varchar(64) NOT NULL,
	`decisionId` varchar(64) NOT NULL,
	`taskId` varchar(64) NOT NULL,
	`metric` varchar(64) NOT NULL,
	`unit` varchar(24) NOT NULL,
	`direction` enum('decrease_is_better','increase_is_better') NOT NULL,
	`currencyCode` varchar(3) NULL,
	`externalKey` varchar(255) NOT NULL,
	`selectorConfig` json NOT NULL,
	`isPrimary` boolean NOT NULL DEFAULT true,
	`status` enum('draft','active','paused','superseded') NOT NULL DEFAULT 'draft',
	`version` int unsigned NOT NULL DEFAULT 1,
	`approvedByUserId` bigint unsigned NULL,
	`approvedByName` varchar(255) NULL,
	`approvedAt` timestamp NULL,
	`collectingAt` timestamp NULL,
	`lastAttemptAt` timestamp NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `outcome_bindings_key_version_unique` UNIQUE(`bindingKey`,`version`)
);
--> statement-breakpoint
CREATE INDEX `outcome_bindings_task_idx` ON `outcome_metric_bindings` (`taskId`);
--> statement-breakpoint
CREATE INDEX `outcome_bindings_source_idx` ON `outcome_metric_bindings` (`sourceId`);
--> statement-breakpoint
CREATE INDEX `outcome_bindings_project_idx` ON `outcome_metric_bindings` (`projectId`);
--> statement-breakpoint
CREATE TABLE `outcome_observations` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`sourceId` varchar(64) NOT NULL,
	`bindingId` bigint unsigned NOT NULL,
	`externalObservationId` varchar(255) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`role` enum('baseline','target','actual') NOT NULL,
	`value` varchar(32) NULL,
	`unit` varchar(24) NOT NULL,
	`currencyCode` varchar(3) NULL,
	`observedAt` timestamp NULL,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	`dataClass` enum('real','synthetic','unknown') NOT NULL DEFAULT 'unknown',
	`validationStatus` enum('validated','rejected') NOT NULL DEFAULT 'rejected',
	`validationErrors` json NOT NULL,
	`sourceRecordUrl` text NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outcome_observations_source_external_role_hash_unique` UNIQUE(`sourceId`,`externalObservationId`,`role`,`payloadHash`)
);
--> statement-breakpoint
CREATE INDEX `outcome_observations_binding_idx` ON `outcome_observations` (`bindingId`);
--> statement-breakpoint
CREATE INDEX `outcome_observations_project_idx` ON `outcome_observations` (`projectId`);
--> statement-breakpoint
ALTER TABLE `outcome_measurements`
	ADD COLUMN `origin` enum('manual','automatic','legacy') NOT NULL DEFAULT 'legacy',
	ADD COLUMN `bindingId` bigint unsigned NULL,
	ADD COLUMN `baselineObservationId` bigint unsigned NULL,
	ADD COLUMN `targetObservationId` bigint unsigned NULL,
	ADD COLUMN `actualObservationId` bigint unsigned NULL,
	ADD COLUMN `baselineObservedAt` timestamp NULL,
	ADD COLUMN `actualObservedAt` timestamp NULL,
	ADD COLUMN `direction` enum('decrease_is_better','increase_is_better') NULL,
	ADD COLUMN `currencyCode` varchar(3) NULL,
	ADD COLUMN `dataClass` enum('real','synthetic','unknown') NOT NULL DEFAULT 'unknown',
	ADD COLUMN `comparabilityStatus` enum('comparable','incomparable','unknown') NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
CREATE INDEX `outcome_measurements_binding_idx` ON `outcome_measurements` (`bindingId`);
--> statement-breakpoint
CREATE TABLE `learning_context_usages` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`proposalId` varchar(64) NOT NULL,
	`proposalVersion` int unsigned NOT NULL,
	`contextHash` varchar(64) NOT NULL,
	`modelId` varchar(255) NOT NULL,
	`measurementRefs` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `learning_usage_proposal_version_hash_unique` UNIQUE(`proposalId`,`proposalVersion`,`contextHash`)
);
--> statement-breakpoint
CREATE INDEX `learning_context_usages_project_idx` ON `learning_context_usages` (`projectId`);
