import { describe, expect, it } from 'vitest';
import {
  buildAssignmentsSearchParams,
  defaultAssignmentFiltersState,
  filtersToListQuery,
  isoToDatetimeLocal,
} from '@/lib/assignments/query';

describe('filtersToListQuery', () => {
  it('converts UI filters to API query and trims assignee', () => {
    const query = filtersToListQuery({
      ...defaultAssignmentFiltersState(),
      status: 'open',
      due_before: '2026-05-30T10:30',
      due_after: '2026-05-20T09:00',
      assignee: '  @lead  ',
      page: 3,
      per_page: 25,
    });

    expect(query.status).toBe('open');
    expect(query.due_before).toBe(new Date('2026-05-30T10:30').toISOString());
    expect(query.due_after).toBe(new Date('2026-05-20T09:00').toISOString());
    expect(query.assignee).toBe('@lead');
    expect(query.page).toBe(3);
    expect(query.per_page).toBe(25);
  });

  it('omits empty values', () => {
    const query = filtersToListQuery(defaultAssignmentFiltersState());
    expect(query.status).toBeUndefined();
    expect(query.assignee).toBeUndefined();
    expect(query.due_before).toBeUndefined();
    expect(query.due_after).toBeUndefined();
  });
});

describe('buildAssignmentsSearchParams', () => {
  it('builds search params for query', () => {
    const params = buildAssignmentsSearchParams({
      status: 'done',
      assignee: '@owner',
      page: 2,
      per_page: 50,
    });

    expect(params.toString()).toBe(
      'status=done&assignee=%40owner&page=2&per_page=50',
    );
  });
});

describe('isoToDatetimeLocal', () => {
  it('returns empty string for empty values', () => {
    expect(isoToDatetimeLocal(null)).toBe('');
    expect(isoToDatetimeLocal(undefined)).toBe('');
    expect(isoToDatetimeLocal('')).toBe('');
  });
});
