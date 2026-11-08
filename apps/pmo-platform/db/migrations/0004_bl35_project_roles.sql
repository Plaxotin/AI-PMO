CREATE TABLE `project_memberships` (
	`id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
	`projectId` varchar(64) NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`role` enum('member','rp','pmo','auditor','c_level') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_memberships_project_user_unique` UNIQUE(`projectId`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `project_memberships_project_role_idx` ON `project_memberships` (`projectId`,`role`);
