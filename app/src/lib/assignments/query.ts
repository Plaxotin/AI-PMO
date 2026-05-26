import type { AssignmentListQuery, AssignmentStatus } from '@/lib/assignments/types';

export type AssignmentFiltersState = {
  status: AssignmentStatus | '';
  due_before: string;
  due_after: string;
  assignee: string;
  page: number;
  per_page: number;
};

export type AssignmentListRequestQuery = Partial<
  Pick<
    AssignmentListQuery,
    'status' | 'due_before' | 'due_after' | 'assignee' | 'source' | 'page' | 'per_page'
  >
>;

export function defaultAssignmentFiltersState(): AssignmentFiltersState {
  return {
    status: '',
    due_before: '',
    due_after: '',
    assignee: '',
    page: 1,
    per_page: 10,
  };
}

export function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export function isoToDatetimeLocal(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function filtersToListQuery(
  filters: AssignmentFiltersState,
): AssignmentListRequestQuery {
  const assignee = filters.assignee.trim();

  return {
    status: filters.status || undefined,
    due_before: datetimeLocalToIso(filters.due_before),
    due_after: datetimeLocalToIso(filters.due_after),
    assignee: assignee || undefined,
    page: filters.page,
    per_page: filters.per_page,
  };
}

export function buildAssignmentsSearchParams(
  query: AssignmentListRequestQuery,
): URLSearchParams {
  const params = new URLSearchParams();

  if (query.status) {
    params.set('status', query.status);
  }
  if (query.due_before) {
    params.set('due_before', query.due_before);
  }
  if (query.due_after) {
    params.set('due_after', query.due_after);
  }
  if (query.assignee) {
    params.set('assignee', query.assignee);
  }
  if (query.source) {
    params.set('source', query.source);
  }
  if (query.page) {
    params.set('page', `${query.page}`);
  }
  if (query.per_page) {
    params.set('per_page', `${query.per_page}`);
  }

  return params;
}
