import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { describe, it } from 'vitest';

import {
  buildInvalidTemplateDocx,
  buildValidTemplateDocx,
} from '@/lib/letters/test-helpers/build-docx';

describe('generate BL18 fixtures', () => {
  it('writes template-valid.docx and template-invalid.docx to repo fixtures/', async () => {
    const dir = join(process.cwd(), '..', 'fixtures', 'bl18');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'template-valid.docx'), buildValidTemplateDocx());
    await writeFile(
      join(dir, 'template-invalid.docx'),
      buildInvalidTemplateDocx(),
    );
  });
});
