import { eq } from "drizzle-orm";
import { users } from "../../db/schema";
import { getDb } from "../../api/queries/connection";
import { signSessionToken } from "../../api/kimi/session";
import { env } from "../../api/lib/env";
import { writeFile } from "node:fs/promises";

const accounts = [
  { unionId: "p0-verifier-rp", name: "Тестовый РП", role: "admin" as const },
  { unionId: "p0-verifier-member", name: "Тестовый участник", role: "user" as const },
];
for (const account of accounts) {
  await getDb().insert(users).values(account).onDuplicateKeyUpdate({ set: { name: account.name, role: account.role } });
}
const [rp, member] = await Promise.all(accounts.map(async (account) => {
  const [user] = await getDb().select().from(users).where(eq(users.unionId, account.unionId));
  return { ...account, id: user.id, token: await signSessionToken({ unionId: account.unionId, clientId: env.appId }) };
}));
await writeFile("/tmp/p0-test-auth.json", JSON.stringify({ rp, member }, null, 2));
console.log(JSON.stringify({ rp: { id: rp.id, role: rp.role }, member: { id: member.id, role: member.role } }));
process.exit(0);
