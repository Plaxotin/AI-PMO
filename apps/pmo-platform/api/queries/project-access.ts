import { and, eq } from "drizzle-orm";
import { projectMemberships, type User } from "@db/schema";
import { getDb } from "./connection";

export const PROJECT_ROLES = ["member", "rp", "pmo", "auditor", "c_level"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * Project membership is authoritative. Platform admin is only a backwards-compatible
 * RP fallback when no explicit membership exists; it never overrides PMO/C-level.
 */
export async function resolveProjectRole(
  user: Pick<User, "id" | "role">,
  projectId = "PRJ-01",
): Promise<ProjectRole> {
  const [membership] = await getDb().select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, user.id)))
    .limit(1);
  if (membership) return membership.role;
  return user.role === "admin" ? "rp" : "member";
}
