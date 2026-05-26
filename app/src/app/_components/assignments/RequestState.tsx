import type { ReactNode } from 'react';

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'Загрузка данных...' }: LoadingStateProps) {
  return (
    <div className="assignment-request-state">
      <div className="assignment-spinner" aria-hidden />
      <p>{label}</p>
    </div>
  );
}

type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="assignment-request-state assignment-request-state--error">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="assignment-button" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="assignment-request-state assignment-request-state--empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
