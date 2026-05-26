'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Assignment } from '@/lib/assignments/types';
import { isoToDatetimeLocal } from '@/lib/assignments/query';

type AssignmentFormMode = 'create' | 'edit';

export type AssignmentFormSubmitValues = {
  title: string;
  description: string | null;
  status: Assignment['status'];
  due_at: string | null;
  assignee_label: string | null;
  source: Assignment['source'];
};

type AssignmentFormProps = {
  mode: AssignmentFormMode;
  assignment: Assignment | null;
  submitting: boolean;
  deleting: boolean;
  onSubmit: (values: AssignmentFormSubmitValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onClearSelection: () => void;
};

type FormState = {
  title: string;
  description: string;
  status: Assignment['status'];
  dueAtLocal: string;
  assigneeLabel: string;
  source: Assignment['source'];
};

function assignmentToFormState(assignment: Assignment | null): FormState {
  if (!assignment) {
    return {
      title: '',
      description: '',
      status: 'draft',
      dueAtLocal: '',
      assigneeLabel: '',
      source: 'manual',
    };
  }
  return {
    title: assignment.title,
    description: assignment.description ?? '',
    status: assignment.status,
    dueAtLocal: isoToDatetimeLocal(assignment.due_at),
    assigneeLabel: assignment.assignee_label ?? '',
    source: assignment.source,
  };
}

export function AssignmentForm({
  mode,
  assignment,
  submitting,
  deleting,
  onSubmit,
  onDelete,
  onClearSelection,
}: AssignmentFormProps) {
  const [formState, setFormState] = useState<FormState>(() =>
    assignmentToFormState(assignment),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFormState(assignmentToFormState(assignment));
    setError(null);
  }, [assignment]);

  const title = useMemo(() => {
    return mode === 'create' ? 'Создать поручение' : 'Редактировать поручение';
  }, [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formState.title.trim()) {
      setError('Укажите заголовок');
      return;
    }
    setError(null);

    const dueAt = formState.dueAtLocal
      ? new Date(formState.dueAtLocal).toISOString()
      : null;

    await onSubmit({
      title: formState.title.trim(),
      description: formState.description.trim() || null,
      status: formState.status,
      due_at: dueAt,
      assignee_label: formState.assigneeLabel.trim() || null,
      source: formState.source,
    });
  }

  return (
    <section className="assignment-panel">
      <div className="assignment-panel__header">
        <h2>{title}</h2>
      </div>

      <form className="assignment-form" onSubmit={handleSubmit}>
        <label className="assignment-field">
          <span>Заголовок *</span>
          <input
            type="text"
            value={formState.title}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, title: event.target.value }))
            }
            disabled={submitting || deleting}
          />
        </label>

        <label className="assignment-field">
          <span>Описание</span>
          <textarea
            rows={4}
            value={formState.description}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, description: event.target.value }))
            }
            disabled={submitting || deleting}
          />
        </label>

        <div className="assignment-form-grid">
          <label className="assignment-field">
            <span>Статус</span>
            <select
              value={formState.status}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  status: event.target.value as Assignment['status'],
                }))
              }
              disabled={submitting || deleting}
            >
              <option value="draft">draft</option>
              <option value="open">open</option>
              <option value="done">done</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>

          <label className="assignment-field">
            <span>Срок</span>
            <input
              type="datetime-local"
              value={formState.dueAtLocal}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  dueAtLocal: event.target.value,
                }))
              }
              disabled={submitting || deleting}
            />
          </label>
        </div>

        <div className="assignment-form-grid">
          <label className="assignment-field">
            <span>Ответственный</span>
            <input
              type="text"
              placeholder="@username"
              value={formState.assigneeLabel}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  assigneeLabel: event.target.value,
                }))
              }
              disabled={submitting || deleting}
            />
          </label>

          <label className="assignment-field">
            <span>Источник</span>
            <select
              value={formState.source}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  source: event.target.value as Assignment['source'],
                }))
              }
              disabled={mode === 'edit' || submitting || deleting}
            >
              <option value="manual">manual</option>
              <option value="import">import</option>
              <option value="webhook">webhook</option>
              <option value="web_upload">web_upload</option>
            </select>
          </label>
        </div>

        {error ? <p className="assignment-error">{error}</p> : null}

        <div className="assignment-actions-row">
          <button type="submit" className="assignment-button" disabled={submitting || deleting}>
            {submitting ? 'Сохраняем...' : mode === 'create' ? 'Создать' : 'Сохранить'}
          </button>

          {mode === 'edit' ? (
            <>
              <button
                type="button"
                className="assignment-button assignment-button--danger"
                onClick={() => void onDelete()}
                disabled={submitting || deleting}
              >
                {deleting ? 'Отмена...' : 'Отменить поручение'}
              </button>
              <button
                type="button"
                className="assignment-button assignment-button--ghost"
                onClick={onClearSelection}
                disabled={submitting || deleting}
              >
                Перейти к созданию
              </button>
            </>
          ) : null}
        </div>
      </form>
    </section>
  );
}
