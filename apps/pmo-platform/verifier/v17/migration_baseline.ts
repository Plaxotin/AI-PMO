import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb } from "../../api/queries/connection";

const migrations = [
  ["0000_bl40_proposal_audit", 1793221835271],
  ["0001_bl36_channel_migration", 1793225347317],
  ["0002_bl42_completion_checks", 1794010343821],
] as const;

const db = getDb();
try {
  await db.execute(sql.raw("DROP TABLE IF EXISTS commitment_outcomes"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS commitment_candidates"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS learning_context_usages"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS outcome_observations"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS outcome_metric_bindings"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS outcome_sources"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS outcome_measurements"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS project_counters"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS telegram_pending_edits"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS telegram_digest_deliveries"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS telegram_onboardings"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS telegram_sla_notifications"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS project_memberships"));
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id bigint unsigned AUTO_INCREMENT PRIMARY KEY, hash text NOT NULL, created_at bigint)"));
  await db.execute(sql.raw("DELETE FROM __drizzle_migrations"));
  for (const [tag, createdAt] of migrations) {
    const payload = await readFile(new URL(`../../db/migrations/${tag}.sql`, import.meta.url));
    const hash = createHash("sha256").update(payload).digest("hex");
    await db.execute(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${hash}, ${createdAt})`);
  }
  console.log(JSON.stringify({ baseline: migrations.map(([tag]) => tag), targets: ["0003_bl42_sla_notifications", "0004_bl35_project_roles", "0005_bl54_first_value", "0006_bl41_telegram_edits", "0007_short_task_ids", "0008_short_decision_ids", "0009_bl48_outcome_measurements", "0010_bl48_kpi_learning_loop", "0011_bl50_commitment_tracking"] }));
} finally {
  if (typeof db.$client?.end === "function") await db.$client.end();
}
