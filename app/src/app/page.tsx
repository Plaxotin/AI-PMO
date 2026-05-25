import Link from 'next/link';
import { DEFAULT_PROJECT_ID } from '@/lib/config';

export default function Home() {
  const assignmentsApi = `/api/projects/${DEFAULT_PROJECT_ID}/assignments`;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">AI PMO — реестр поручений</h1>
      <p className="text-neutral-600">
        Фаза BL1-0: контракты, миграция v1, скелет REST API. CRUD и UI — в BL1-1 и BL1-2.
      </p>
      <ul className="list-disc space-y-2 pl-5 text-sm text-neutral-700">
        <li>
          <Link className="text-blue-600 underline" href={assignmentsApi}>
            GET {assignmentsApi}
          </Link>
        </li>
        <li>
          Документация env:{' '}
          <code className="rounded bg-neutral-100 px-1">docs/plans/BL1-0_ENV.md</code>
        </li>
        <li>
          Глобальный <code className="rounded bg-neutral-100 px-1">projectId</code>:{' '}
          {DEFAULT_PROJECT_ID}
        </li>
      </ul>
    </main>
  );
}
