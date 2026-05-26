import type { AssignmentDetails } from '@/lib/assignments/api-client';
import type { AssignmentStatusEvent } from '@/lib/assignments/types';

type AssignmentCardProps = {
  assignment: AssignmentDetails;
};

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString();
}

function eventDescription(event: AssignmentStatusEvent): string {
  if (event.event_type === 'created') {
    return 'Создано поручение';
  }
  if (event.event_type === 'cancelled') {
    return 'Поручение отменено';
  }
  if (event.event_type === 'status_change') {
    return `Статус: ${event.from_status ?? '—'} → ${event.to_status ?? '—'}`;
  }
  if (event.event_type === 'field_change') {
    return `Поле ${event.field_name ?? '—'}: ${String(event.old_value)} → ${String(
      event.new_value,
    )}`;
  }
  return event.event_type;
}

export function AssignmentCard({ assignment }: AssignmentCardProps) {
  return (
    <section className="assignment-panel">
      <div className="assignment-panel__header">
        <h2>Карточка поручения</h2>
        <span className={`assignment-status assignment-status--${assignment.status}`}>
          {assignment.status}
        </span>
      </div>

      <dl className="assignment-card-grid">
        <div>
          <dt>ID</dt>
          <dd>{assignment.id}</dd>
        </div>
        <div>
          <dt>Project ID</dt>
          <dd>{assignment.project_id}</dd>
        </div>
        <div>
          <dt>Версия</dt>
          <dd>{assignment.version}</dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd>{assignment.source}</dd>
        </div>
        <div>
          <dt>Заголовок</dt>
          <dd>{assignment.title}</dd>
        </div>
        <div>
          <dt>Описание</dt>
          <dd>{assignment.description || '—'}</dd>
        </div>
        <div>
          <dt>Срок</dt>
          <dd>{formatDateTime(assignment.due_at)}</dd>
        </div>
        <div>
          <dt>Ответственный</dt>
          <dd>{assignment.assignee_label || '—'}</dd>
        </div>
        <div>
          <dt>Owner ID</dt>
          <dd>{assignment.owner_id || '—'}</dd>
        </div>
        <div>
          <dt>Создано</dt>
          <dd>{formatDateTime(assignment.created_at)}</dd>
        </div>
        <div>
          <dt>Обновлено</dt>
          <dd>{formatDateTime(assignment.updated_at)}</dd>
        </div>
      </dl>

      <div className="assignment-history">
        <h3>История изменений</h3>
        {assignment.history.length === 0 ? (
          <p className="assignment-muted">Событий пока нет</p>
        ) : (
          <ul>
            {assignment.history.map((event) => (
              <li key={event.id} className="assignment-history-item">
                <p>{eventDescription(event)}</p>
                <small>{formatDateTime(event.created_at)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
