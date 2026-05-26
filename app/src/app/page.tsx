'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AssignmentVersionConflictError,
  AssignmentsApiError,
  createAssignment,
  deleteAssignment,
  getAssignment,
  listAssignments,
  patchAssignment,
  type AssignmentDetails,
  type AssignmentListResponse,
} from '@/lib/assignments/api-client';
import {
  applyOptimisticCancel,
  applyOptimisticPatch,
  upsertAssignment,
  type AssignmentPatchChanges,
} from '@/lib/assignments/optimistic';
import {
  defaultAssignmentFiltersState,
  filtersToListQuery,
  type AssignmentFiltersState,
} from '@/lib/assignments/query';
import type { Assignment } from '@/lib/assignments/types';
import { DEFAULT_PROJECT_ID } from '@/lib/config';
import { AssignmentCard } from '@/app/_components/assignments/AssignmentCard';
import {
  AssignmentForm,
  type AssignmentFormSubmitValues,
} from '@/app/_components/assignments/AssignmentForm';
import { AssignmentsFiltersBar } from '@/app/_components/assignments/AssignmentsFiltersBar';
import { AssignmentsList } from '@/app/_components/assignments/AssignmentsList';
import { ConflictDialog } from '@/app/_components/assignments/ConflictDialog';
import { EmptyState, ErrorState, LoadingState } from '@/app/_components/assignments/RequestState';

type VersionConflictState = {
  assignment: Assignment;
  attemptedChanges: AssignmentPatchChanges;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof AssignmentsApiError) {
    return `${error.message} (${error.code})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Неизвестная ошибка. Повторите попытку.';
}

function replaceAssignmentInList(
  previous: AssignmentListResponse | null,
  assignment: Assignment,
): AssignmentListResponse | null {
  if (!previous) {
    return previous;
  }
  return {
    ...previous,
    data: upsertAssignment(previous.data, assignment),
  };
}

function withOptimisticCreate(
  previous: AssignmentListResponse | null,
  assignment: Assignment,
): AssignmentListResponse | null {
  if (!previous) {
    return previous;
  }
  return {
    ...previous,
    data: [assignment, ...previous.data],
    meta: {
      ...previous.meta,
      total: previous.meta.total + 1,
    },
  };
}

export default function Home() {
  const [filtersDraft, setFiltersDraft] = useState<AssignmentFiltersState>(() =>
    defaultAssignmentFiltersState(),
  );
  const [activeFilters, setActiveFilters] = useState<AssignmentFiltersState>(() =>
    defaultAssignmentFiltersState(),
  );

  const [listData, setListData] = useState<AssignmentListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [details, setDetails] = useState<AssignmentDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflictState | null>(null);
  const [retryingConflict, setRetryingConflict] = useState(false);

  const loadList = useCallback(async (filters: AssignmentFiltersState) => {
    setListLoading(true);
    setListError(null);
    try {
      const response = await listAssignments({
        projectId: DEFAULT_PROJECT_ID,
        query: filtersToListQuery(filters),
      });
      setListData(response);
      setSelectedAssignmentId((currentSelected) => {
        if (currentSelected && response.data.some((item) => item.id === currentSelected)) {
          return currentSelected;
        }
        return response.data[0]?.id ?? null;
      });
    } catch (error) {
      setListError(toErrorMessage(error));
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async (assignmentId: string) => {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const response = await getAssignment(assignmentId, {
        projectId: DEFAULT_PROJECT_ID,
      });
      setDetails(response);
    } catch (error) {
      setDetailsError(toErrorMessage(error));
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(activeFilters);
  }, [activeFilters, loadList]);

  useEffect(() => {
    if (!selectedAssignmentId) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    void loadDetails(selectedAssignmentId);
  }, [loadDetails, selectedAssignmentId]);

  const selectedAssignment = useMemo(() => {
    if (details && selectedAssignmentId && details.id === selectedAssignmentId) {
      return details;
    }
    return (
      listData?.data.find((item) => item.id === selectedAssignmentId) ?? null
    );
  }, [details, listData?.data, selectedAssignmentId]);

  const formMode = selectedAssignment ? 'edit' : 'create';

  async function handleCreate(values: AssignmentFormSubmitValues) {
    const nowIso = new Date().toISOString();
    const optimisticAssignment: Assignment = {
      id: crypto.randomUUID(),
      project_id: DEFAULT_PROJECT_ID,
      title: values.title,
      description: values.description,
      status: values.status,
      due_at: values.due_at,
      owner_id: null,
      assignee_label: values.assignee_label,
      source: values.source,
      version: 1,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const previousList = listData;
    setListData((prev) => withOptimisticCreate(prev, optimisticAssignment));
    setSelectedAssignmentId(optimisticAssignment.id);

    try {
      const created = await createAssignment(
        {
          title: values.title,
          description: values.description,
          status: values.status,
          due_at: values.due_at,
          assignee_label: values.assignee_label,
          source: values.source,
        },
        { projectId: DEFAULT_PROJECT_ID },
      );

      setListData((prev) => {
        if (!prev) {
          return prev;
        }
        const data = prev.data.map((item) =>
          item.id === optimisticAssignment.id ? created : item,
        );
        return { ...prev, data };
      });
      setSelectedAssignmentId(created.id);
      await loadDetails(created.id);
    } catch (error) {
      setListData(previousList);
      setSelectedAssignmentId((prev) =>
        prev === optimisticAssignment.id ? null : prev,
      );
      setMutationError(toErrorMessage(error));
    } finally {
      void loadList(activeFilters);
    }
  }

  async function handlePatch(
    baseAssignment: Assignment,
    changes: AssignmentPatchChanges,
    versionOverride?: number,
  ) {
    const nowIso = new Date().toISOString();
    const previousList = listData;
    const previousDetails = details;
    const optimistic = applyOptimisticPatch(baseAssignment, changes, nowIso);

    setListData((prev) => replaceAssignmentInList(prev, optimistic));
    setDetails((prev) => {
      if (!prev || prev.id !== baseAssignment.id) {
        return prev;
      }
      return {
        ...prev,
        ...optimistic,
      };
    });

    try {
      const updated = await patchAssignment(
        baseAssignment.id,
        {
          version: versionOverride ?? baseAssignment.version,
          ...changes,
        },
        { projectId: DEFAULT_PROJECT_ID },
      );

      setConflict(null);
      setListData((prev) => replaceAssignmentInList(prev, updated));
      setSelectedAssignmentId(updated.id);
      await loadDetails(updated.id);
    } catch (error) {
      if (error instanceof AssignmentVersionConflictError) {
        setConflict({
          assignment: error.assignment,
          attemptedChanges: changes,
        });
        setListData((prev) => replaceAssignmentInList(prev, error.assignment));
        setDetails((prev) => {
          if (!prev || prev.id !== error.assignment.id) {
            return prev;
          }
          return {
            ...prev,
            ...error.assignment,
          };
        });
        await loadDetails(error.assignment.id);
        return;
      }

      setListData(previousList);
      setDetails(previousDetails);
      setMutationError(toErrorMessage(error));
    } finally {
      void loadList(activeFilters);
    }
  }

  async function handleDelete(assignment: Assignment) {
    const nowIso = new Date().toISOString();
    const previousList = listData;
    const previousDetails = details;
    const optimistic = applyOptimisticCancel(assignment, nowIso);

    setListData((prev) => replaceAssignmentInList(prev, optimistic));
    setDetails((prev) => {
      if (!prev || prev.id !== assignment.id) {
        return prev;
      }
      return {
        ...prev,
        ...optimistic,
      };
    });

    try {
      const cancelled = await deleteAssignment(assignment.id, {
        projectId: DEFAULT_PROJECT_ID,
      });
      setListData((prev) => replaceAssignmentInList(prev, cancelled));
      setSelectedAssignmentId(cancelled.id);
      await loadDetails(cancelled.id);
    } catch (error) {
      setListData(previousList);
      setDetails(previousDetails);
      setMutationError(toErrorMessage(error));
    } finally {
      void loadList(activeFilters);
    }
  }

  async function handleFormSubmit(values: AssignmentFormSubmitValues) {
    setMutationError(null);
    setSaving(true);
    try {
      if (formMode === 'create') {
        await handleCreate(values);
        return;
      }

      if (!selectedAssignment) {
        setMutationError('Выберите поручение для редактирования');
        return;
      }

      const changes: AssignmentPatchChanges = {};
      if (values.title !== selectedAssignment.title) {
        changes.title = values.title;
      }
      if ((values.description ?? null) !== (selectedAssignment.description ?? null)) {
        changes.description = values.description;
      }
      if (values.status !== selectedAssignment.status) {
        changes.status = values.status;
      }
      if ((values.due_at ?? null) !== (selectedAssignment.due_at ?? null)) {
        changes.due_at = values.due_at;
      }
      if (
        (values.assignee_label ?? null) !== (selectedAssignment.assignee_label ?? null)
      ) {
        changes.assignee_label = values.assignee_label;
      }

      if (Object.keys(changes).length === 0) {
        setMutationError('Нет изменений для сохранения');
        return;
      }

      await handlePatch(selectedAssignment, changes);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteClick() {
    if (!selectedAssignment) {
      return;
    }
    setMutationError(null);
    setDeleting(true);
    try {
      await handleDelete(selectedAssignment);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRetryConflict() {
    if (!conflict) {
      return;
    }

    setRetryingConflict(true);
    setMutationError(null);
    try {
      await handlePatch(
        conflict.assignment,
        conflict.attemptedChanges,
        conflict.assignment.version,
      );
    } finally {
      setRetryingConflict(false);
    }
  }

  function handleAcceptServer() {
    if (!conflict) {
      return;
    }
    setConflict(null);
    setSelectedAssignmentId(conflict.assignment.id);
    void loadDetails(conflict.assignment.id);
  }

  return (
    <main className="assignments-layout">
      <header className="assignment-header">
        <h1>AI PMO — реестр поручений</h1>
        <p className="assignment-muted">
          MVP без обязательной auth, project scope: <code>{DEFAULT_PROJECT_ID}</code>
        </p>
      </header>

      {mutationError ? (
        <ErrorState message={mutationError} onRetry={() => setMutationError(null)} />
      ) : null}

      <div className="assignments-grid">
        <section className="assignments-column">
          <AssignmentsFiltersBar
            value={filtersDraft}
            loading={listLoading}
            onChange={setFiltersDraft}
            onApply={() => setActiveFilters(filtersDraft)}
            onReset={() => {
              const defaults = defaultAssignmentFiltersState();
              setFiltersDraft(defaults);
              setActiveFilters(defaults);
              setSelectedAssignmentId(null);
              setDetails(null);
            }}
          />

          {listLoading && !listData ? <LoadingState label="Загрузка списка..." /> : null}
          {!listLoading && listError ? (
            <ErrorState message={listError} onRetry={() => void loadList(activeFilters)} />
          ) : null}
          {!listLoading && !listError && listData && listData.data.length === 0 ? (
            <EmptyState
              title="Поручений не найдено"
              description="Создайте новое поручение или измените фильтры."
            />
          ) : null}
          {!listError && listData && listData.data.length > 0 ? (
            <AssignmentsList
              assignments={listData.data}
              page={listData.meta.page}
              perPage={listData.meta.per_page}
              total={listData.meta.total}
              loading={listLoading}
              selectedId={selectedAssignmentId}
              onSelect={setSelectedAssignmentId}
              onPageChange={(page) =>
                setActiveFilters((prev) => ({ ...prev, page: Math.max(1, page) }))
              }
              onPerPageChange={(perPage) =>
                setActiveFilters((prev) => ({ ...prev, page: 1, per_page: perPage }))
              }
            />
          ) : null}
        </section>

        <section className="assignments-column">
          <AssignmentForm
            mode={formMode}
            assignment={selectedAssignment}
            submitting={saving}
            deleting={deleting}
            onSubmit={handleFormSubmit}
            onDelete={handleDeleteClick}
            onClearSelection={() => {
              setSelectedAssignmentId(null);
              setDetails(null);
              setDetailsError(null);
              setConflict(null);
            }}
          />

          {selectedAssignmentId && detailsLoading ? (
            <LoadingState label="Загрузка карточки..." />
          ) : null}
          {selectedAssignmentId && detailsError ? (
            <ErrorState
              message={detailsError}
              onRetry={() => void loadDetails(selectedAssignmentId)}
            />
          ) : null}
          {details ? <AssignmentCard assignment={details} /> : null}
          {!selectedAssignmentId ? (
            <EmptyState
              title="Выберите поручение из списка"
              description="Для карточки и истории нужно выбрать запись слева."
            />
          ) : null}
        </section>
      </div>

      <ConflictDialog
        conflict={conflict}
        retrying={retryingConflict}
        onAcceptServer={handleAcceptServer}
        onRetry={() => void handleRetryConflict()}
      />
    </main>
  );
}
