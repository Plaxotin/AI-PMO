import PizZip from 'pizzip';

import type { RequiredPlaceholderName } from '@/lib/letters/types';
import { REQUIRED_PLACEHOLDER_NAMES } from '@/lib/letters/types';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function paragraph(placeholder: string): string {
  return `<w:p><w:r><w:t>{{${placeholder}}}</w:t></w:r></w:p>`;
}

export function buildMinimalDocxBuffer(
  placeholders: string[],
  extraParts?: Record<string, string>,
): Buffer {
  const body = placeholders.map(paragraph).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;

  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', documentXml);
  if (extraParts) {
    for (const [path, xml] of Object.entries(extraParts)) {
      zip.file(path, xml);
    }
  }
  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

export function buildValidTemplateDocx(): Buffer {
  return buildMinimalDocxBuffer([...REQUIRED_PLACEHOLDER_NAMES]);
}

export function buildInvalidTemplateDocx(): Buffer {
  return buildMinimalDocxBuffer(['SIGNATORY_NAME', 'SIGNATORY_TITLE']);
}

export function buildDocxWithHeaderPlaceholder(): Buffer {
  return buildMinimalDocxBuffer([...REQUIRED_PLACEHOLDER_NAMES], {
    'word/header1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>{{HEADER_MARKER}}</w:t></w:r></w:p>
</w:hdr>`,
  });
}

export type { RequiredPlaceholderName };
