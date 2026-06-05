import { describe, expect, it } from 'vitest';

import {
  buildDocxWithHeaderPlaceholder,
  buildInvalidTemplateDocx,
  buildValidTemplateDocx,
} from '@/lib/letters/test-helpers/build-docx';
import { extractPlaceholdersFromDocx } from '@/lib/letters/template-placeholders';
import { validateTemplatePlaceholders } from '@/lib/letters/template-validation';
import { REQUIRED_PLACEHOLDER_NAMES } from '@/lib/letters/types';

describe('extractPlaceholdersFromDocx', () => {
  it('finds all required placeholders in document.xml', () => {
    const buf = buildValidTemplateDocx();
    const found = extractPlaceholdersFromDocx(buf);
    for (const name of REQUIRED_PLACEHOLDER_NAMES) {
      expect(found.has(name)).toBe(true);
    }
  });

  it('finds placeholders in header parts', () => {
    const buf = buildDocxWithHeaderPlaceholder();
    const found = extractPlaceholdersFromDocx(buf);
    expect(found.has('HEADER_MARKER')).toBe(true);
    expect(found.has('LETTER_BODY')).toBe(true);
  });

  it('validateTemplatePlaceholders fails when LETTER_BODY missing', () => {
    const buf = buildInvalidTemplateDocx();
    const found = extractPlaceholdersFromDocx(buf);
    const result = validateTemplatePlaceholders(found);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain('LETTER_BODY');
      expect(result.checklist.length).toBeGreaterThan(0);
    }
  });
});
