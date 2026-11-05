ALTER TABLE `risks`
  ADD `confidence` int unsigned;--> statement-breakpoint
ALTER TABLE `decisions`
  ADD `proposalVersion` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events`
  ADD `channel` varchar(24),
  ADD `version` int unsigned,
  ADD `sourceLinks` json,
  ADD `diff` text,
  ADD `metadata` json;--> statement-breakpoint
CREATE TABLE `proposal_versions` (
  `id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
  `projectId` varchar(64) NOT NULL,
  `proposalId` varchar(64) NOT NULL,
  `version` int unsigned NOT NULL,
  `title` text NOT NULL,
  `rationale` text NOT NULL,
  `effect` text NOT NULL,
  `owner` varchar(255) NOT NULL,
  `due` varchar(16) NOT NULL,
  `sourceVersionId` bigint unsigned,
  `actorUserId` bigint unsigned,
  `actorName` varchar(255) NOT NULL,
  `actorRole` varchar(24) NOT NULL,
  `attribution` varchar(255) NOT NULL,
  `editDistance` int unsigned,
  `diff` text,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  CONSTRAINT `proposal_versions_proposal_version_unique` UNIQUE (`proposalId`, `version`)
);--> statement-breakpoint
CREATE INDEX `proposal_versions_project_idx` ON `proposal_versions` (`projectId`);--> statement-breakpoint
INSERT INTO `proposal_versions` (
  `projectId`, `proposalId`, `version`, `title`, `rationale`, `effect`,
  `owner`, `due`, `actorName`, `actorRole`, `attribution`
)
SELECT
  `projectId`, `id`, 1, `title`, `rationale`, `effect`,
  COALESCE(`proposalOwner`, 'Руководитель проекта'),
  COALESCE(`proposalDue`, '—'),
  'Пиэмка', 'system', 'Пиэмка · автоматически'
FROM `decisions`;
