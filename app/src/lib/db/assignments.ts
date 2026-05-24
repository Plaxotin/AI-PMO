import { getSql, rowToAssignment } from '@/lib/db/client';
import type { AssignmentListQuery } from '@/lib/assignments/types';

export async function listAssignments(
  projectId: string,
  query: AssignmentListQuery,
) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const conditions: string[] = ['project_id = $1'];
  const params: unknown[] = [projectId];
  let paramIndex = 2;

  if (query.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(query.status);
  }
  if (query.due_from) {
    conditions.push(`due_at >= $${paramIndex++}`);
    params.push(query.due_from);
  }
  if (query.due_to) {
    conditions.push(`due_at <= $${paramIndex++}`);
    params.push(query.due_to);
  }
  if (query.q) {
    conditions.push(
      `(title ILIKE $${paramIndex} OR assignee_label ILIKE $${paramIndex} OR COALESCE(description, '') ILIKE $${paramIndex})`,
    );
    params.push(`%${query.q}%`);
    paramIndex += 1;
  }

  const where = conditions.join(' AND ');

  const countRows = await sql.unsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM assignments WHERE ${where}`,
    params as never[],
  );
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await sql.unsafe(
    `SELECT * FROM assignments WHERE ${where}
     ORDER BY due_at NULLS LAST, created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, query.limit, query.offset] as never[],
  );

  return {
    data: rows.map((row) => rowToAssignment(row as never)),
    meta: { total, limit: query.limit, offset: query.offset },
  };
}

export async function getAssignmentById(projectId: string, assignmentId: string) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql`
    SELECT * FROM assignments
    WHERE project_id = ${projectId} AND id = ${assignmentId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return undefined;
  }
  return rowToAssignment(rows[0] as never);
}
