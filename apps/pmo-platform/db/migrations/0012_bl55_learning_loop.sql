CREATE TABLE `logic_change_proposals` (
	`id` varchar(64) PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`cluster` varchar(64) NOT NULL,
	`question` text NOT NULL,
	`currentVersion` varchar(64) NOT NULL,
	`proposedVersion` varchar(64) NOT NULL,
	`changeType` enum('prompt','threshold','rule','model') NOT NULL,
	`rationale` text NOT NULL,
	`evidenceRefs` json NOT NULL,
	`expectedMetric` varchar(64) NOT NULL,
	`baselineMetrics` json NOT NULL,
	`status` enum('proposed','approved','rejected','testing','applied','rolled_back') NOT NULL DEFAULT 'proposed',
	`approvedByUserId` bigint unsigned NULL,
	`regressionResult` json NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`approvedAt` timestamp NULL,
	`appliedAt` timestamp NULL,
	`rolledBackAt` timestamp NULL
);
--> statement-breakpoint
CREATE INDEX `logic_change_proposals_project_idx` ON `logic_change_proposals` (`projectId`);
--> statement-breakpoint
CREATE TABLE `golden_regression_cases` (
	`id` varchar(64) PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`question` text NOT NULL,
	`input` text NOT NULL,
	`expected` json NOT NULL,
	`sourceCorrectionId` varchar(64) NOT NULL,
	`modelId` varchar(255) NOT NULL,
	`version` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE INDEX `golden_regression_cases_project_idx` ON `golden_regression_cases` (`projectId`);
