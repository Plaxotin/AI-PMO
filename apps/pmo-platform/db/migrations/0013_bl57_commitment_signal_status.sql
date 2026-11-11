ALTER TABLE `signals`
  MODIFY COLUMN `status` enum('processing','risk_created','commitment_created','ignored','error') NOT NULL DEFAULT 'processing';
