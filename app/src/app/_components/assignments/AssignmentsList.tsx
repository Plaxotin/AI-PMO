import type { Assignment } from '@/lib/assignments/types';

type AssignmentsListProps = {
  assignments: Assignment[];
  page: number;
  perPage: number;
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (assignmentId: string) => void;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
};

function formatDue(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString();
}

export function AssignmentsList({
  assignments,
  page,
  perPage,
  total,
  loading,
  selectedId,
  onSelect,
  onPageChange,
  onPerPageChange,
}: AssignmentsListProps) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <section className="assignment-panel">
      <div className="assignment-panel__header">
        <h2>Реестр поручений</h2>
        <p className="assignment-muted">Всего: {total}</p>
      </div>

      <ul className="assignment-list">
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <button
              type="button"
              className={`assignment-list-item ${
                assignment.id === selectedId ? 'assignment-list-item--selected' : ''
              }`}
              onClick={() => onSelect(assignment.id)}
              disabled={loading}
            >
              <div className="assignment-list-item__main">
                <strong>{assignment.title}</strong>
                <span className={`assignment-status assignment-status--${assignment.status}`}>
                  {assignment.status}
                </span>
              </div>
              <div className="assignment-list-item__meta">
                <span>Срок: {formatDue(assignment.due_at)}</span>
                <span>Ответственный: {assignment.assignee_label || '—'}</span>
                <span>v{assignment.version}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="assignment-pagination">
        <label className="assignment-field">
          <span>На странице</span>
          <select
            value={perPage}
            onChange={(event) => onPerPageChange(Number(event.target.value))}
            disabled={loading}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>

        <div className="assignment-actions-row">
          <button
            type="button"
            className="assignment-button assignment-button--ghost"
            onClick={() => onPageChange(page - 1)}
            disabled={loading || page <= 1}
          >
            Назад
          </button>
          <span className="assignment-muted">
            Страница {page} из {totalPages}
          </span>
          <button
            type="button"
            className="assignment-button assignment-button--ghost"
            onClick={() => onPageChange(page + 1)}
            disabled={loading || page >= totalPages}
          >
            Вперёд
          </button>
        </div>
      </div>
    </section>
  );
}
