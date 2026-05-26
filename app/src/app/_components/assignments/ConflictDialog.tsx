import type { Assignment } from '@/lib/assignments/types';
import type { AssignmentPatchChanges } from '@/lib/assignments/optimistic';

type ConflictDialogProps = {
  conflict: {
    assignment: Assignment;
    attemptedChanges: AssignmentPatchChanges;
  } | null;
  retrying: boolean;
  onAcceptServer: () => void;
  onRetry: () => void;
};

export function ConflictDialog({
  conflict,
  retrying,
  onAcceptServer,
  onRetry,
}: ConflictDialogProps) {
  if (!conflict) {
    return null;
  }

  const attemptedEntries = Object.entries(conflict.attemptedChanges);

  return (
    <div className="assignment-dialog-backdrop" role="presentation">
      <div className="assignment-dialog" role="dialog" aria-modal="true">
        <h3>Конфликт версии (409)</h3>
        <p>
          Запись уже изменили. Текущая версия на сервере: v{conflict.assignment.version}.
        </p>
        <dl className="assignment-card-grid">
          <div>
            <dt>Серверный заголовок</dt>
            <dd>{conflict.assignment.title}</dd>
          </div>
          <div>
            <dt>Серверный статус</dt>
            <dd>{conflict.assignment.status}</dd>
          </div>
          <div>
            <dt>Серверный срок</dt>
            <dd>{conflict.assignment.due_at ?? '—'}</dd>
          </div>
          <div>
            <dt>Серверный ответственный</dt>
            <dd>{conflict.assignment.assignee_label ?? '—'}</dd>
          </div>
        </dl>

        <div className="assignment-dialog__changes">
          <h4>Ваши изменения</h4>
          {attemptedEntries.length === 0 ? (
            <p>Нет полей для повторной отправки.</p>
          ) : (
            <ul>
              {attemptedEntries.map(([key, value]) => (
                <li key={key}>
                  <strong>{key}</strong>: {String(value)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="assignment-actions-row">
          <button
            type="button"
            className="assignment-button assignment-button--ghost"
            onClick={onAcceptServer}
            disabled={retrying}
          >
            Принять состояние сервера
          </button>
          <button
            type="button"
            className="assignment-button"
            onClick={onRetry}
            disabled={retrying || attemptedEntries.length === 0}
          >
            {retrying ? 'Повторяем...' : 'Повторить мои изменения'}
          </button>
        </div>
      </div>
    </div>
  );
}
