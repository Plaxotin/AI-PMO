import PizZip from 'pizzip';

const PLACEHOLDER_RE = /\{\{([A-Z0-9_]+)\}\}/g;

const XML_PARTS = [
  'word/document.xml',
  /^word\/header\d+\.xml$/,
  /^word\/footer\d+\.xml$/,
];

function shouldScanPart(name: string): boolean {
  if (name === 'word/document.xml') return true;
  return /^word\/(header|footer)\d+\.xml$/.test(name);
}

/**
 * Extract unique `{{NAME}}` placeholders from DOCX XML parts (no LLM).
 */
export function extractPlaceholdersFromDocx(buffer: Buffer): Set<string> {
  const zip = new PizZip(buffer);
  const found = new Set<string>();

  for (const name of Object.keys(zip.files)) {
    if (!shouldScanPart(name)) continue;
    const file = zip.files[name];
    if (!file || file.dir) continue;
    const xml = file.asText();
    let match: RegExpExecArray | null;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((match = PLACEHOLDER_RE.exec(xml)) !== null) {
      found.add(match[1]);
    }
  }

  return found;
}

export { PLACEHOLDER_RE, XML_PARTS };
