import type { DocStatus, TaskStatus } from './types';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Не начато',
  in_progress: 'В работе',
  review: 'На согласовании',
  done: 'Завершено',
  overdue: 'Просрочено',
};

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  draft: 'Черновик',
  in_progress: 'В разработке',
  review: 'На согласовании',
  approved: 'Утверждён',
  overdue: 'Просрочен',
};

export const TASK_STATUS_OPTIONS: TaskStatus[] = [
  'not_started',
  'in_progress',
  'review',
  'done',
  'overdue',
];

export const DOC_STATUS_OPTIONS: DocStatus[] = [
  'draft',
  'in_progress',
  'review',
  'approved',
  'overdue',
];

export function taskStatusTone(status: TaskStatus): string {
  switch (status) {
    case 'not_started':
      return 'border-border bg-bg-deep text-text-muted';
    case 'in_progress':
      return 'border-cyan/25 bg-cyan-glow text-cyan';
    case 'review':
      return 'border-blue/25 bg-blue-glow text-blue';
    case 'done':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400';
    case 'overdue':
      return 'border-red-500/25 bg-red-500/10 text-red-400';
  }
}

export function docStatusTone(status: DocStatus): string {
  return taskStatusTone(status as TaskStatus);
}

export function sourceLabel(source: 'tracker' | 'schedule'): string {
  return source === 'tracker' ? 'Таск-трекер' : 'План-график';
}
