import { and, eq, inArray } from "drizzle-orm";
import { auditEvents, decisions, tasks, users } from "../../db/schema";
import { getDb } from "../../api/queries/connection";

const db = getDb();
await db.delete(auditEvents).where(eq(auditEvents.actorName, "Тестовый РП"));
await db.delete(tasks).where(and(eq(tasks.id, "P-D-02"), eq(tasks.decisionId, "D-02")));
await db.update(decisions).set({ status: "wait", attribution: null, decidedByUserId: null, decidedAt: null, displayDate: "18.09" }).where(eq(decisions.id, "D-02"));
await db.delete(users).where(inArray(users.unionId, ["p0-verifier-rp", "p0-verifier-member"]));
const [decision] = await db.select().from(decisions).where(eq(decisions.id, "D-02"));
const linked = await db.select().from(tasks).where(eq(tasks.decisionId, "D-02"));
const testUsers = await db.select().from(users).where(inArray(users.unionId, ["p0-verifier-rp", "p0-verifier-member"]));
console.log(JSON.stringify({ decision: decision.status, linkedTasks: linked.length, testUsers: testUsers.length }));
process.exit(0);
