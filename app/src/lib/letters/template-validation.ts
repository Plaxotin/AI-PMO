import {
  REQUIRED_PLACEHOLDER_NAMES,
  type RequiredPlaceholderName,
} from '@/lib/letters/types';

export type TemplateValidationResult =
  | { ok: true; placeholders: string[] }
  | {
      ok: false;
      missing: RequiredPlaceholderName[];
      checklist: string[];
    };

export function buildPlaceholderChecklist(
  missing: RequiredPlaceholderName[],
): string[] {
  return missing.map(
    (name) =>
      `Добавьте в шаблон DOCX плейсхолдер {{${name}}} (см. документацию BL-18).`,
  );
}

export function validateTemplatePlaceholders(
  found: Set<string>,
): TemplateValidationResult {
  const missing = REQUIRED_PLACEHOLDER_NAMES.filter(
    (name) => !found.has(name),
  );

  if (missing.length === 0) {
    return { ok: true, placeholders: [...found].sort() };
  }

  return {
    ok: false,
    missing,
    checklist: buildPlaceholderChecklist(missing),
  };
}
