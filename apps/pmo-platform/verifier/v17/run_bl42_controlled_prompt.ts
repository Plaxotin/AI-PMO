import { runDueCompletionChecks } from "../../api/telegram/completion-scheduler";
import { getDb } from "../../api/queries/connection";

async function main() {
  try {
    const summary = await runDueCompletionChecks(new Date("2026-11-07T06:00:00.000Z"));
    console.log(JSON.stringify({ controlledTime: "2026-11-07T09:00:00+03:00", summary }));
  } finally {
    const db = getDb();
    if (typeof db.$client?.end === "function") await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
