import type { SheetRow } from '@/lib/pmi/types';

/**
 * Local UI preview without Google OAuth. Never enabled in production.
 * Opt-in only: BL6_DEV_SKIP_GOOGLE_AUTH=true in app/.env.local
 */
export function isDevPreviewMode(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const flag = process.env.BL6_DEV_SKIP_GOOGLE_AUTH?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

export function getDevPreviewRows(): SheetRow[] {
  return DEV_PREVIEW_ROWS;
}

const DEV_PREVIEW_ROWS: SheetRow[] = [
  {
    row_number: 2,
    id: 1,
    brief_name: 'Подготовка IT-инфраструктуры',
    description: 'Развернуть стенд для пилота',
    source: 'Совещание',
    owner: 'Архитектор ИС и инфраструктуры ИТ',
    priority: 2,
    date_added: '01.03.2025',
    target_date: '15.04.2025',
    status: 2,
  },
  {
    row_number: 3,
    id: 2,
    brief_name: 'Обновить функциональность ПО',
    description: null,
    source: 'Email',
    owner: 'Архитектор ИС и инфраструктуры ИТ',
    priority: 1,
    date_added: '05.03.2025',
    target_date: '31.03.2025',
    status: 2,
  },
  {
    row_number: 4,
    id: 3,
    brief_name: 'Разработка новых модулей',
    description: 'MVP модуля отчётности',
    source: 'Поручение',
    owner: 'Ведущий IT-архитектор компании',
    priority: 1,
    date_added: '10.03.2025',
    target_date: '22.04.2025',
    status: 1,
  },
  {
    row_number: 5,
    id: 4,
    brief_name: 'Согласовать бюджет',
    description: null,
    source: 'Совещание',
    owner: 'Ведущий IT-архитектор компании',
    priority: 2,
    date_added: '12.03.2025',
    target_date: '12.04.2025',
    status: 2,
  },
  {
    row_number: 6,
    id: 5,
    brief_name: 'Запуск системы мониторинга',
    description: null,
    source: 'Telegram',
    owner: 'Руководитель службы эксплуатации',
    priority: 2,
    date_added: '15.03.2025',
    target_date: '01.04.2025',
    status: 3,
  },
  {
    row_number: 7,
    id: 6,
    brief_name: 'Миграция базы данных',
    description: 'План отката',
    source: 'Поручение',
    owner: 'Дата инженер (BI)',
    priority: 3,
    date_added: '20.03.2025',
    target_date: '10.05.2025',
    status: 1,
  },
];
