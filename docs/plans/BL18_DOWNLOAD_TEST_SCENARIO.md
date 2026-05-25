# BL-18 — Download Files Fix & Test Scenario

**Parent plan:** `docs/plans/BL18_PLAN.md`
**Repository:** `Plaxotin/AI-PMO` (single `index.html`, inline CSS/JS, deployed on Vercel)
**Created:** 2026-05-25

---

## Planning summary

The BL-18 letter generator workspace produces two downloadable files: `letter.docx` and `letter-package.zip`. The DOCX download is **broken** — it creates a plain-text Blob labelled with the Office Open XML MIME type, which Microsoft Word (and most other word processors) rejects on open. The ZIP download uses a custom `buildMinimalZip()` function that constructs valid uncompressed ZIP structures, but the `letter.docx` entry inside it is also plain text — making the inner DOCX file equally invalid.

This plan defines a single phase: fix the DOCX generation to produce a minimal but structurally valid Office Open XML package, then verify both downloads thoroughly.

**Key architectural insight:** A `.docx` file **is** a ZIP archive containing XML files. The existing `buildMinimalZip()` function can be reused to assemble the DOCX by packaging the required XML parts into a ZIP with the `.docx` extension and the correct MIME type.

---

## Defect analysis

### Defect 1 — `letter.docx` is invalid (critical)

**Location:** `index.html`, line ~2667–2670.

```js
dlDocxBtn.addEventListener('click',function(){
    var blob=new Blob([lastGeneratedText],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    triggerDownload(blob,'letter.docx');
});
```

**Root cause:** The Blob contains UTF-8 plain text. A valid `.docx` requires an Office Open XML (OOXML) package — a ZIP archive with at minimum:

| Path inside the ZIP | Purpose |
|---|---|
| `[Content_Types].xml` | Declares MIME types for each part |
| `_rels/.rels` | Top-level relationships (points to `word/document.xml`) |
| `word/document.xml` | The document body (WordprocessingML XML) |

Without these, Word shows "We're sorry. We can't open … because we found a problem with its contents" and refuses to load the file.

**Impact:** The "Download DOCX" button produces a file that cannot be opened in Word, LibreOffice Writer, Google Docs import, or any OOXML-compliant reader.

### Defect 2 — `letter.docx` inside `letter-package.zip` is also invalid

**Location:** `index.html`, line ~2672–2689.

```js
var zipFiles=[{name:'letter.docx',content:lastGeneratedText}];
```

The ZIP handler passes the same plain-text string as the content for the `letter.docx` entry. Even though the outer ZIP is structurally valid (the `buildMinimalZip` function constructs correct local/central headers and EOCD), the inner `letter.docx` is just a text file with a `.docx` extension — it will fail to open in Word if extracted.

### Defect 3 (potential) — `buildMinimalZip()` only handles text content

`buildMinimalZip()` takes `files[i].content` as a string and encodes it via `new TextEncoder().encode(...)`. After the DOCX fix, the content for `letter.docx` inside the ZIP will need to be a binary `Uint8Array` (the assembled OOXML ZIP bytes), not a string. The function must accept either string or `Uint8Array` content.

---

## Fix approach

### Step A — Create `buildDocxBlob(text)` function

A new pure-JS function that takes the letter text (string) and returns a `Blob` containing a valid OOXML `.docx` file. It works by:

1. XML-escaping the text (`&`, `<`, `>`, `"`, `'`).
2. Splitting the text into lines and wrapping each line in a `<w:p><w:r><w:t>…</w:t></w:r></w:p>` paragraph element.
3. Assembling three XML strings:
   - `[Content_Types].xml` — declares `word/document.xml` as `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml` and the relationship type for `_rels/.rels`.
   - `_rels/.rels` — a single relationship pointing to `word/document.xml`.
   - `word/document.xml` — a minimal `<w:document>` with the paragraphs from step 2.
4. Calling `buildMinimalZip()` with these three file entries to produce a valid ZIP/DOCX Blob.

### Step B — Update `buildMinimalZip()` to accept binary content

Modify the function so that if `files[i].content` is already a `Uint8Array`, it is used directly; otherwise it is encoded from string via `TextEncoder`. This allows embedding binary data (the DOCX blob bytes) inside the outer letter-package ZIP.

### Step C — Update `dlDocxBtn` handler

Replace the plain-text Blob with a call to `buildDocxBlob(lastGeneratedText)`.

### Step D — Update `dlZipBtn` handler

Instead of passing `lastGeneratedText` as the string content for `letter.docx` inside the ZIP, generate the DOCX bytes first (via `buildDocxBlob` returning an `ArrayBuffer` or building the zip entries directly), then include those bytes as binary content in the outer ZIP.

### Constraints

- **No external dependencies.** The fix must be pure inline JS in `index.html`.
- **Reuse `buildMinimalZip()`.** Since DOCX is a ZIP, the existing function is the assembler.
- **Minimal valid OOXML.** The goal is a file that opens without errors in Word and LibreOffice. Advanced formatting (fonts, margins, headers) is not required for this landing-page demo, but basic paragraph structure must be correct.
- **Cyrillic support.** The XML must declare UTF-8 encoding and handle Cyrillic text correctly.
- **Special characters.** The letter text may contain `&`, `<`, `>`, quotes — all must be XML-escaped.

---

## Phase BL18-DL

- **phase_id:** `BL18-DL`
- **title:** Fix DOCX generation to valid OOXML and verify both download files
- **goal:** Make the "Download DOCX" button produce a file that opens without errors in Microsoft Word and LibreOffice Writer. Ensure the `letter.docx` inside the ZIP package is equally valid. Verify both downloads with automated and manual checks.
- **scope:**
  - New function `buildDocxBlob(text)` that returns a valid OOXML `.docx` Blob using `buildMinimalZip()` internally.
  - Update `buildMinimalZip()` to accept `Uint8Array` content in addition to strings.
  - Update `dlDocxBtn` click handler to use `buildDocxBlob()`.
  - Update `dlZipBtn` click handler to embed valid DOCX bytes (not plain text) as the `letter.docx` entry.
  - Ensure the generated XML is well-formed, UTF-8, and properly escapes special characters and Cyrillic.
- **out_of_scope:**
  - Rich formatting (bold, italic, tables, images, page margins, headers/footers).
  - Real template injection or docxtpl-style placeholder replacement.
  - Changes to the mock letter text generation logic (`buildMockLetter`).
  - Changes to the preview panel rendering.
  - Backend or API changes (there are none).
- **dependencies:** BL18-P3 verified (the workspace and download buttons already exist and work end-to-end minus the DOCX validity issue).
- **files_or_areas:**
  - `index.html` — JS section only: new `buildDocxBlob()` function, modified `buildMinimalZip()`, modified `dlDocxBtn` handler, modified `dlZipBtn` handler.
- **acceptance_criteria:**
  1. The downloaded `letter.docx` is a valid ZIP archive (can be unzipped).
  2. The unzipped DOCX contains `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`.
  3. `word/document.xml` is well-formed XML with correct WordprocessingML namespace.
  4. The DOCX opens without errors in LibreOffice Writer (terminal verification via `libreoffice --headless --convert-to pdf`).
  5. The DOCX content shows the letter text with each line as a separate paragraph.
  6. Cyrillic text is rendered correctly (not garbled or replaced with `?`).
  7. Special characters (`&`, `<`, `>`, `"`, `'`) in the letter body are properly escaped and displayed.
  8. The downloaded `letter-package.zip` is a valid ZIP archive.
  9. Extracting `letter-package.zip` yields `letter.docx` (valid OOXML) plus placeholder attachment entries.
  10. The `letter.docx` extracted from the ZIP opens without errors and shows the correct letter text.
  11. No regressions: the generate flow, preview, audit log, and all other workspace functionality continue to work.
  12. No console errors during the entire flow.
- **testing_scenario:** See dedicated section below.
- **status:** `planned`

---

## Testing scenario

### Definition of "valid" for each file

| File | Format | "Valid" means |
|---|---|---|
| `letter.docx` | Office Open XML (OOXML) | A ZIP archive containing at minimum `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`. Opens without error in Microsoft Word 2016+ and LibreOffice Writer 7+. Displays the letter text as readable paragraphs. |
| `letter-package.zip` | ZIP archive | A valid ZIP that standard archivers (unzip, 7-Zip, macOS Archive Utility) can extract without error. Contains `letter.docx` (valid OOXML as above) plus zero or more attachment placeholder files. |

For the landing-page demo context: the DOCX does not need headers, footers, page numbers, custom fonts, or corporate letterhead styling. It must be structurally valid OOXML that opens and displays text content without errors.

---

### Prerequisites

**Environment:**
- Serve `index.html` locally: `python3 -m http.server 8080`
- Open `http://localhost:8080` in a Chromium-based browser (Chrome)
- Have `unzip`, `xmllint`, and `python3` available in terminal for validation
- Optionally have `libreoffice` installed for headless conversion test

**Test data preparation:**
- Create a minimal valid `.docx` file for the template upload (any small `.docx`, even one created by this fix itself after initial testing)
- Prepare attachment files: `report.xlsx` (or any file renamed to `.xlsx`), `note.pdf` (or any file renamed to `.pdf`)

---

### Test 1 — DOCX structural validity (terminal-driven)

**Setup:**
1. Serve locally and open the letters workspace in browser.
2. Upload any `.docx` as template, enter text: `Test letter content.`
3. Click "Generate letter", then "Download DOCX".
4. Copy the downloaded `letter.docx` to a working directory.

**Actions:**
1. Run: `file letter.docx` — verify output says "Zip archive data" or "Microsoft Word" (not "ASCII text" or "UTF-8 text").
2. Run: `unzip -l letter.docx` — verify it lists `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`.
3. Run: `unzip -o letter.docx -d docx_extracted/`
4. Run: `xmllint --noout docx_extracted/\[Content_Types\].xml` — verify exit code 0 (well-formed XML).
5. Run: `xmllint --noout docx_extracted/_rels/.rels` — verify exit code 0.
6. Run: `xmllint --noout docx_extracted/word/document.xml` — verify exit code 0.
7. Inspect `docx_extracted/word/document.xml` — verify it contains `<w:document` with namespace `http://schemas.openxmlformats.org/wordprocessingml/2006/main` and `<w:p>` paragraph elements containing the letter text.

**Expected result:** All 7 checks pass. The file is a valid ZIP containing well-formed OOXML parts.

**Evidence:** Terminal output of `file`, `unzip -l`, and `xmllint` commands.

---

### Test 2 — DOCX opens in LibreOffice (terminal-driven)

**Setup:** Use the same `letter.docx` from Test 1.

**Actions:**
1. Run: `libreoffice --headless --convert-to pdf letter.docx` (or `soffice` if `libreoffice` is not in PATH).
2. Verify the command exits with code 0 and produces `letter.pdf`.
3. Verify `letter.pdf` file size > 0 bytes.

**Expected result:** LibreOffice converts the DOCX to PDF without errors, confirming the file is a valid word-processing document.

**Evidence:** Terminal output showing successful conversion; `ls -la letter.pdf` output.

---

### Test 3 — DOCX text content fidelity (terminal-driven)

**Setup:**
1. Generate a letter with the following content (includes Cyrillic, special characters, and multi-line text):
   ```
   Просим предоставить документы & отчёты по проекту "Альфа" <срочно>.
   Второй параграф с символами: 'кавычки', «ёлочки», знак > и знак <.
   ```
2. Download the DOCX.

**Actions:**
1. Unzip the DOCX and read `word/document.xml`.
2. Verify that `&` is escaped as `&amp;`, `<` as `&lt;`, `>` as `&gt;`, `"` as `&quot;` in the XML.
3. Verify Cyrillic characters are present as literal UTF-8 (not numeric entities or question marks).
4. Verify each input line appears as a separate `<w:p>` element.
5. Convert to PDF via LibreOffice and visually confirm the text is legible.

**Expected result:** XML is well-formed with correct escaping; Cyrillic text is preserved; each line is a paragraph; PDF shows readable Cyrillic text.

**Evidence:** `grep` output from `document.xml` showing escaped characters; PDF file for visual inspection.

---

### Test 4 — ZIP structural validity (terminal-driven)

**Setup:**
1. Generate a letter with 2 attachments (`report.xlsx`, `note.pdf`).
2. Click "Download ZIP package" to get `letter-package.zip`.

**Actions:**
1. Run: `file letter-package.zip` — verify output says "Zip archive data".
2. Run: `unzip -l letter-package.zip` — verify it lists `letter.docx`, `report.xlsx`, `note.pdf`.
3. Run: `unzip -t letter-package.zip` — verify "No errors detected in compressed data".
4. Run: `unzip -o letter-package.zip -d zip_extracted/`
5. Run: `file zip_extracted/letter.docx` — verify it says "Zip archive data" or "Microsoft Word" (the inner DOCX must also be a valid ZIP/OOXML, not plain text).
6. Run: `unzip -l zip_extracted/letter.docx` — verify it contains `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`.

**Expected result:** The outer ZIP is valid. The inner `letter.docx` is a valid OOXML file (not plain text). Attachment placeholders are present as entries.

**Evidence:** Terminal output of `file`, `unzip -l`, and `unzip -t` commands for both the outer ZIP and inner DOCX.

---

### Test 5 — Inner DOCX from ZIP opens correctly (terminal-driven)

**Setup:** Use `zip_extracted/letter.docx` from Test 4.

**Actions:**
1. Run: `libreoffice --headless --convert-to pdf zip_extracted/letter.docx`
2. Verify successful conversion (exit code 0, PDF file produced).
3. Verify the PDF content matches the letter text.

**Expected result:** The DOCX extracted from the ZIP package opens and converts without errors.

**Evidence:** Terminal output and resulting PDF file.

---

### Test 6 — Edge case: no attachments (terminal-driven + GUI)

**Setup:**
1. Generate a letter with NO attachments.
2. Download both DOCX and ZIP.

**Actions:**
1. Verify `letter.docx` is valid OOXML (repeat `file` + `unzip -l` checks).
2. Verify `letter-package.zip` contains only `letter.docx` (no attachment entries).
3. Run: `unzip -t letter-package.zip` — no errors.
4. Verify the DOCX text includes "Attachments: None" (or localized equivalent).

**Expected result:** Both files are valid even with zero attachments.

---

### Test 7 — Edge case: maximum attachments (5 files) (GUI + terminal)

**Setup:**
1. Upload 5 attachment files (e.g. `a1.xlsx`, `a2.xlsx`, `a3.pdf`, `a4.docx`, `a5.pdf`).
2. Generate the letter and download the ZIP.

**Actions:**
1. Run: `unzip -l letter-package.zip` — verify it lists `letter.docx` + 5 attachment entries (6 total).
2. Verify `letter.docx` inside the ZIP is valid OOXML.
3. Verify no filename collisions in the ZIP listing.

**Expected result:** All 6 entries present, no name collisions, valid structure.

---

### Test 8 — Edge case: duplicate attachment filenames (GUI + terminal)

**Setup:**
1. Upload 3 attachments all named `report.xlsx` (browsers allow this from different directories).
2. Generate and download the ZIP.

**Actions:**
1. Run: `unzip -l letter-package.zip` — verify entries are `letter.docx`, `report.xlsx`, `report_2.xlsx`, `report_3.xlsx` (or similar dedup scheme).
2. Verify no duplicate entry names.

**Expected result:** The existing dedup logic (`_2`, `_3` suffix) produces unique names.

---

### Test 9 — Edge case: empty letter content (GUI + terminal)

**Setup:**
1. Note: the "Generate letter" button should be disabled if letter content is empty. If the user somehow triggers generation with empty content (e.g. whitespace only), the DOCX should still be valid.
2. If the button is disabled, enter a single space as content to test near-empty input.

**Actions:**
1. Download DOCX. Run `file` + `unzip -l` checks.
2. Verify the DOCX is structurally valid even with minimal/empty body text.
3. Verify `word/document.xml` contains at least one `<w:p>` element (even if the text node is empty).

**Expected result:** Structurally valid DOCX even with minimal content.

---

### Test 10 — Edge case: special characters in letter text (terminal-driven)

**Setup:**
1. Generate a letter with text containing XML-sensitive characters:
   ```
   Price: $100 & tax <5%> for "item" at Tom's store.
   Символы: ё, Ё, й, щ, ъ, №, ©, ™, €, ¥, £
   Math: 2 < 3 > 1 && true
   Ampersand: AT&T, R&D
   ```
2. Download the DOCX.

**Actions:**
1. Unzip and validate `word/document.xml` with `xmllint --noout` (must exit 0).
2. Verify `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;` in the raw XML.
3. Convert to PDF via LibreOffice and verify all special characters display correctly.

**Expected result:** Well-formed XML; all special characters preserved and rendered correctly.

---

### Test 11 — Regression: full end-to-end flow (GUI-driven)

**Setup:** Open letters workspace in browser.

**Actions:**
1. Upload a `.docx` template.
2. Enter Cyrillic letter content.
3. Add 2 attachments.
4. Click "Generate letter" — verify spinner, then result appears.
5. Verify letter preview shows correct text with `{{SIGNATORY_NAME}}` / `{{SIGNATORY_TITLE}}` placeholders.
6. Click "Download DOCX" — verify download starts.
7. Click "Download ZIP package" — verify download starts.
8. Click "Show audit log" — verify entry appears with correct fields.
9. Toggle language to RU — verify all text switches.
10. Toggle back to EN — verify all text switches back.
11. Open browser DevTools console — verify zero errors throughout.

**Expected result:** Full flow works without regressions. Downloads trigger. Audit log is accurate. Language toggle works. No console errors.

**Evidence:** Screenshots or screen recording of the full flow.

---

### Test 12 — Regression: other tools unaffected (GUI-driven)

**Setup:** Close the letters workspace.

**Actions:**
1. Click another tool card (e.g. "Project plan audit") — verify the generic workspace opens.
2. Close it. Reopen the letters workspace — verify it opens correctly.
3. Close letters workspace — verify return to landing page.

**Expected result:** No cross-contamination between workspaces. Other tools work as before.

---

## Test result matrix (for Verifier)

| Test | Type | Status | Notes |
|---|---|---|---|
| T1 — DOCX structural validity | Terminal | `pending` | |
| T2 — DOCX opens in LibreOffice | Terminal | `pending` | |
| T3 — DOCX text content fidelity | Terminal | `pending` | |
| T4 — ZIP structural validity | Terminal | `pending` | |
| T5 — Inner DOCX from ZIP | Terminal | `pending` | |
| T6 — No attachments | Terminal+GUI | `pending` | |
| T7 — Max attachments (5) | Terminal+GUI | `pending` | |
| T8 — Duplicate filenames | Terminal+GUI | `pending` | |
| T9 — Empty content | Terminal+GUI | `pending` | |
| T10 — Special characters | Terminal | `pending` | |
| T11 — Full E2E regression | GUI | `pending` | |
| T12 — Other tools unaffected | GUI | `pending` | |

---

## Open questions

None — the fix approach is straightforward and all constraints are clear.

---

## Implementer handoff

Request implementation of phase **BL18-DL**. The Implementer should:

1. Read the defect analysis and fix approach sections above.
2. Implement `buildDocxBlob(text)` as described in Step A.
3. Update `buildMinimalZip()` per Step B (accept `Uint8Array` content).
4. Update both download handlers per Steps C and D.
5. Self-test by running Tests 1–5 before marking `ready_for_test`.
6. The Verifier will execute the full test matrix (Tests 1–12).
