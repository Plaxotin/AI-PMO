import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">AI PMO</h1>
      <p className="text-neutral-600">
        BL2-0: единый экран реестра поручений с Google Sheets, smart-input и AI-инжестом
        файлов.
      </p>
      <Link
        className="inline-flex w-fit rounded-lg bg-blue-600 px-5 py-2.5 text-white hover:bg-blue-500"
        href="/assignments"
      >
        Открыть реестр поручений (BL-6)
      </Link>
    </main>
  );
}
