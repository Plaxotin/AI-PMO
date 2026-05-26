import type { Assignment, PatchAssignmentBody } from '@/lib/assignments/types';

export type AssignmentPatchChanges = Omit<PatchAssignmentBody, 'version'>;

export function upsertAssignment(
  assignments: Assignment[],
  assignment: Assignment,
): Assignment[] {
  const index = assignments.findIndex((item) => item.id === assignment.id);
  if (index === -1) {
    return [assignment, ...assignments];
  }

  const next = [...assignments];
  next[index] = assignment;
  return next;
}

export function applyOptimisticPatch(
  assignment: Assignment,
  changes: AssignmentPatchChanges,
  nowIso: string,
): Assignment {
  return {
    ...assignment,
    ...(changes.title !== undefined ? { title: changes.title } : {}),
    ...(changes.description !== undefined
      ? { description: changes.description ?? null }
      : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(changes.due_at !== undefined ? { due_at: changes.due_at ?? null } : {}),
    ...(changes.assignee_label !== undefined
      ? { assignee_label: changes.assignee_label ?? null }
      : {}),
    version: assignment.version + 1,
    updated_at: nowIso,
  };
}

export function applyOptimisticCancel(
  assignment: Assignment,
  nowIso: string,
): Assignment {
  if (assignment.status === 'cancelled') {
    return assignment;
  }
  return {
    ...assignment,
    status: 'cancelled',
    version: assignment.version + 1,
    updated_at: nowIso,
  };
}
