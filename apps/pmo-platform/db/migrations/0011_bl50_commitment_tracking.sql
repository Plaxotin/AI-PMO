CREATE TABLE `commitment_candidates` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`signalId` varchar(64) NOT NULL,
	`decisionId` varchar(64) NULL,
	`taskId` varchar(64) NULL,
	`existingTaskId` varchar(64) NULL,
	`title` text NOT NULL,
	`owner` varchar(255) NOT NULL,
	`due` varchar(16) NOT NULL,
	`confidence` int unsigned NOT NULL,
	`changeType` enum('create','update') NOT NULL DEFAULT 'create',
	`status` enum('pending','pending_merge','accepted','edited','rejected','merged','ignored','completed') NOT NULL DEFAULT 'pending',
	`rejectionReason` enum('not_commitment','already_done','wont_do') NULL,
	`evidenceVersion` int unsigned NOT NULL DEFAULT 1,
	`evidenceHash` varchar(64) NOT NULL,
	`editDistance` int unsigned NULL,
	`decidedAt` timestamp NULL,
	`completedAt` timestamp NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commitment_candidates_signal_evidence_unique` UNIQUE(`signalId`,`evidenceVersion`)
);
--> statement-breakpoint
CREATE INDEX `commitment_candidates_decision_idx` ON `commitment_candidates` (`decisionId`);
--> statement-breakpoint
CREATE INDEX `commitment_candidates_task_idx` ON `commitment_candidates` (`taskId`);
--> statement-breakpoint
CREATE INDEX `commitment_candidates_project_idx` ON `commitment_candidates` (`projectId`);
--> statement-breakpoint
CREATE TABLE `commitment_outcomes` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`taskId` varchar(64) NOT NULL,
	`decisionId` varchar(64) NULL,
	`outcome` enum('on_time','late','ignored','unknown') NOT NULL DEFAULT 'unknown',
	`resultText` text NOT NULL,
	`completedAt` timestamp NULL,
	`source` text NOT NULL,
	`sourceId` varchar(255) NOT NULL,
	`expectedEffect` text NULL,
	`effectAssessment` json NULL,
	`recordedByUserId` bigint unsigned NOT NULL,
	`recordedByName` varchar(255) NOT NULL,
	`recordedByRole` varchar(24) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commitment_outcomes_task_unique` UNIQUE(`taskId`)
);
--> statement-breakpoint
CREATE INDEX `commitment_outcomes_decision_idx` ON `commitment_outcomes` (`decisionId`);
--> statement-breakpoint
CREATE INDEX `commitment_outcomes_project_idx` ON `commitment_outcomes` (`projectId`);
