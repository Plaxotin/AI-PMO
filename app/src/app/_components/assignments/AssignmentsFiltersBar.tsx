import type { AssignmentFiltersState } from '@/lib/assignments/query';

type AssignmentsFiltersBarProps = {
  value: AssignmentFiltersState;
  loading: boolean;
  onChange: (next: AssignmentFiltersState) => void;
  onApply: () => void;
  onReset: () => void;
};

export function AssignmentsFiltersBar({
  value,
  loading,
  onChange,
  onApply,
  onReset,
}: AssignmentsFiltersBarProps) {
  return (
    <section className="assignment-panel">
      <div className="assignment-panel__header">
        <h2>Фильтры</h2>
      </div>
      <div className="assignment-filters-grid">
        <label className="assignment-field">
          <span>Статус</span>
          <select
            value={value.status}
            onChange={(event) =>
              onChange({
                ...value,
                status: event.target.value as AssignmentFiltersState['status'],
                page: 1,
              })
            }
          >
            <option value="">Все</option>
            <option value="draft">draft</option>
            <option value="open">open</option>
            <option value="done">done</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>

        <label className="assignment-field">
          <span>Срок после</span>
          <input
            type="datetime-local"
            value={value.due_after}
            onChange={(event) =>
              onChange({ ...value, due_after: event.target.value, page: 1 })
            }
          />
        </label>

        <label className="assignment-field">
          <span>Срок до</span>
          <input
            type="datetime-local"
            value={value.due_before}
            onChange={(event) =>
              onChange({ ...value, due_before: event.target.value, page: 1 })
            }
          />
        </label>

        <label className="assignment-field">
          <span>Ответственный (точное совпадение)</span>
          <input
            type="text"
            placeholder="@username"
            value={value.assignee}
            onChange={(event) =>
              onChange({ ...value, assignee: event.target.value, page: 1 })
            }
          />
        </label>
      </div>

      <div className="assignment-actions-row">
        <button type="button" className="assignment-button" onClick={onApply} disabled={loading}>
          Применить
        </button>
        <button
          type="button"
          className="assignment-button assignment-button--ghost"
          onClick={onReset}
          disabled={loading}
        >
          Сбросить
        </button>
      </div>
    </section>
  );
}
