import {
  getSql,
  rowToAssignment,
  rowToAssignmentEvent,
  type DbAssignmentEventRow,
  type DbAssignmentRow,
} from '@/lib/db/client';
import type {
  AssignmentListQuery,
  CreateAssignmentBody,
  PatchAssignmentBody,
} from '@/lib/assignments/types';

type SqlClient = NonNullable<ReturnType<typeof getSql>>;

type AssignmentEventType =
  | 'created'
  | 'status_change'
  | 'field_change'
  | 'cancelled';

type UpdateAssignmentResult =
  | { kind: 'updated'; assignment: ReturnType<typeof rowToAssignment> }
  | { kind: 'version_conflict'; current: ReturnType<typeof rowToAssignment> }
  | { kind: 'not_found' };

function toJsonbParam(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function dueAtToIso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function insertAssignmentEvent(
  sql: SqlClient,
  payload: {
    assignment_id: string;
    event_type: AssignmentEventType;
    field_name?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    old_value?: unknown;
    new_value?: unknown;
    actor_id: string | null;
  },
) {
  await sql`
    INSERT INTO assignment_status_events (
      assignment_id,
      event_type,
      field_name,
      from_status,
      to_status,
      old_value,
      new_value,
      actor_id
    ) VALUES (
      ${payload.assignment_id},
      ${payload.event_type}::assignment_event_type,
      ${payload.field_name ?? null},
      ${payload.from_status ?? null}::assignment_status,
      ${payload.to_status ?? null}::assignment_status,
      ${toJsonbParam(payload.old_value)}::jsonb,
      ${toJsonbParam(payload.new_value)}::jsonb,
      ${payload.actor_id}
    )
  `;
}

export async function listAssignments(projectId: string, query: AssignmentListQuery) {
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
  if (query.due_before) {
    conditions.push(`due_at <= $${paramIndex++}`);
    params.push(query.due_before);
  }
  if (query.due_after) {
    conditions.push(`due_at >= $${paramIndex++}`);
    params.push(query.due_after);
  }
  if (query.assignee) {
    conditions.push(`assignee_label = $${paramIndex++}`);
    params.push(query.assignee);
  }
  if (query.source) {
    conditions.push(`source = $${paramIndex++}`);
    params.push(query.source);
  }

  const where = conditions.join(' AND ');
  const offset = (query.page - 1) * query.per_page;

  const countRows = await sql.unsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM assignments WHERE ${where}`,
    params as never[],
  );
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await sql.unsafe<DbAssignmentRow[]>(
    `SELECT * FROM assignments WHERE ${where}
     ORDER BY due_at NULLS LAST, created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, query.per_page, offset] as never[],
  );

  return {
    data: rows.map((row) => rowToAssignment(row)),
    meta: { total, page: query.page, per_page: query.per_page },
  };
}

export async function createAssignment(
  projectId: string,
  payload: CreateAssignmentBody,
  actorId: string | null,
) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql<DbAssignmentRow[]>`
    INSERT INTO assignments (
      project_id,
      title,
      description,
      status,
      due_at,
      assignee_label,
      source
    ) VALUES (
      ${projectId},
      ${payload.title},
      ${payload.description ?? null},
      ${payload.status},
      ${payload.due_at ?? null},
      ${payload.assignee_label ?? null},
      ${payload.source}
    )
    RETURNING *
  `;

  const created = rowToAssignment(rows[0]);
  await insertAssignmentEvent(sql, {
    assignment_id: created.id,
    event_type: 'created',
    from_status: null,
    to_status: created.status,
    actor_id: actorId,
  });

  return created;
}

export async function getAssignmentById(projectId: string, assignmentId: string) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql<DbAssignmentRow[]>`
    SELECT * FROM assignments
    WHERE project_id = ${projectId} AND id = ${assignmentId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return undefined;
  }
  return rowToAssignment(rows[0]);
}

export async function updateAssignment(
  projectId: string,
  assignmentId: string,
  payload: PatchAssignmentBody,
  actorId: string | null,
): Promise<UpdateAssignmentResult | null> {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const previousRows = await sql<DbAssignmentRow[]>`
    SELECT * FROM assignments
    WHERE project_id = ${projectId} AND id = ${assignmentId}
    LIMIT 1
  `;

  if (previousRows.length === 0) {
    return { kind: 'not_found' };
  }

  const updates: string[] = [];
  const params: unknown[] = [projectId, assignmentId, payload.version];
  let paramIndex = 4;

  if (payload.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    params.push(payload.title);
  }
  if (payload.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(payload.description);
  }
  if (payload.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    params.push(payload.status);
  }
  if (payload.due_at !== undefined) {
    updates.push(`due_at = $${paramIndex++}`);
    params.push(payload.due_at);
  }
  if (payload.assignee_label !== undefined) {
    updates.push(`assignee_label = $${paramIndex++}`);
    params.push(payload.assignee_label);
  }

  updates.push('version = version + 1');

  const updatedRows = await sql.unsafe<DbAssignmentRow[]>(
    `UPDATE assignments
     SET ${updates.join(', ')}
     WHERE project_id = $1 AND id = $2 AND version = $3
     RETURNING *`,
    params as never[],
  );

  if (updatedRows.length === 0) {
    const currentRows = await sql<DbAssignmentRow[]>`
      SELECT * FROM assignments
      WHERE project_id = ${projectId} AND id = ${assignmentId}
      LIMIT 1
    `;

    if (currentRows.length === 0) {
      return { kind: 'not_found' };
    }
    return { kind: 'version_conflict', current: rowToAssignment(currentRows[0]) };
  }

  const previous = previousRows[0];
  const updated = updatedRows[0];

  if (previous.status !== updated.status) {
    await insertAssignmentEvent(sql, {
      assignment_id: assignmentId,
      event_type: 'status_change',
      from_status: previous.status,
      to_status: updated.status,
      actor_id: actorId,
    });
  }

  const dueBefore = dueAtToIso(previous.due_at);
  const dueAfter = dueAtToIso(updated.due_at);
  const fieldChanges: Array<{
    field_name: string;
    old_value: unknown;
    new_value: unknown;
  }> = [];

  if (previous.title !== updated.title) {
    fieldChanges.push({
      field_name: 'title',
      old_value: previous.title,
      new_value: updated.title,
    });
  }
  if ((previous.description ?? null) !== (updated.description ?? null)) {
    fieldChanges.push({
      field_name: 'description',
      old_value: previous.description ?? null,
      new_value: updated.description ?? null,
    });
  }
  if (dueBefore !== dueAfter) {
    fieldChanges.push({
      field_name: 'due_at',
      old_value: dueBefore,
      new_value: dueAfter,
    });
  }
  if ((previous.assignee_label ?? null) !== (updated.assignee_label ?? null)) {
    fieldChanges.push({
      field_name: 'assignee_label',
      old_value: previous.assignee_label ?? null,
      new_value: updated.assignee_label ?? null,
    });
  }

  for (const fieldChange of fieldChanges) {
    await insertAssignmentEvent(sql, {
      assignment_id: assignmentId,
      event_type: 'field_change',
      field_name: fieldChange.field_name,
      old_value: fieldChange.old_value,
      new_value: fieldChange.new_value,
      actor_id: actorId,
    });
  }

  return { kind: 'updated', assignment: rowToAssignment(updated) };
}

export async function cancelAssignment(
  projectId: string,
  assignmentId: string,
  actorId: string | null,
) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const existingRows = await sql<DbAssignmentRow[]>`
    SELECT * FROM assignments
    WHERE project_id = ${projectId} AND id = ${assignmentId}
    LIMIT 1
  `;

  if (existingRows.length === 0) {
    return undefined;
  }

  const existing = existingRows[0];
  if (existing.status === 'cancelled') {
    return rowToAssignment(existing);
  }

  const rows = await sql<DbAssignmentRow[]>`
    UPDATE assignments
    SET status = 'cancelled', version = version + 1
    WHERE project_id = ${projectId} AND id = ${assignmentId}
    RETURNING *
  `;

  if (rows.length === 0) {
    return undefined;
  }

  await insertAssignmentEvent(sql, {
    assignment_id: assignmentId,
    event_type: 'cancelled',
    from_status: existing.status,
    to_status: 'cancelled',
    actor_id: actorId,
  });

  return rowToAssignment(rows[0]);
}

export async function listAssignmentHistoryEvents(
  projectId: string,
  assignmentId: string,
) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql<DbAssignmentEventRow[]>`
    SELECT e.*
    FROM assignment_status_events e
    INNER JOIN assignments a ON a.id = e.assignment_id
    WHERE a.project_id = ${projectId} AND e.assignment_id = ${assignmentId}
    ORDER BY e.created_at ASC, e.id ASC
  `;

  return rows.map((row) => rowToAssignmentEvent(row));
}
