INSERT INTO `project_counters` (`projectId`,`counterName`,`nextValue`)
SELECT 'PRJ-01', 'decision', COALESCE(MAX(CAST(SUBSTRING(`id`, 3) AS UNSIGNED)), 0)
FROM `decisions`
WHERE `id` REGEXP '^D-[0-9]+$'
ON DUPLICATE KEY UPDATE `nextValue` = GREATEST(`nextValue`, VALUES(`nextValue`));
