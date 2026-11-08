CREATE TABLE `telegram_completion_checks` (
  `id` bigint unsigned AUTO_INCREMENT PRIMARY KEY,
  `taskId` varchar(64) NOT NULL,
  `dueVersion` varchar(16) NOT NULL,
  `chatId` varchar(64) NOT NULL,
  `userId` varchar(64) NOT NULL,
  `promptMessageId` bigint,
  `status` enum('sending','pending','done','not_done','failed','unknown') NOT NULL DEFAULT 'sending',
  `effectStatus` enum('none','pending','sending','sent','failed','unknown') NOT NULL DEFAULT 'none',
  `effectMessageId` bigint,
  `error` text,
  `respondedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `telegram_completion_task_due_user_unique` UNIQUE(`taskId`,`dueVersion`,`userId`)
);--> statement-breakpoint
CREATE INDEX `telegram_completion_status_idx` ON `telegram_completion_checks` (`status`,`effectStatus`);
