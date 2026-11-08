CREATE TABLE `project_counters` (
	`projectId` varchar(64) NOT NULL,
	`counterName` varchar(32) NOT NULL,
	`nextValue` bigint unsigned NOT NULL,
	CONSTRAINT `project_counters_project_name_unique` UNIQUE(`projectId`,`counterName`)
);
--> statement-breakpoint
INSERT INTO `project_counters` (`projectId`,`counterName`,`nextValue`)
SELECT 'PRJ-01', 'task', COALESCE(MAX(CAST(SUBSTRING(`id`, 3) AS UNSIGNED)), 0)
FROM `tasks`
WHERE `id` REGEXP '^P-[0-9]+$'
ON DUPLICATE KEY UPDATE `nextValue` = GREATEST(`nextValue`, VALUES(`nextValue`));
