# BL-18 — Official Letter Generator: Implementation Plan

**Spec:** `docs/SPEC-BL-18-official-letter-generator.md`
**Repository:** `Plaxotin/AI-PMO` (single `index.html`, inline CSS/JS, deployed on Vercel)
**Created:** 2026-05-24

---

## Planning summary

This plan breaks the BL-18 letter generator landing-page workspace into **3 sequential phases**, all within `index.html`. The letters tool card (`data-tool-id="letters"`) currently routes to a shared generic workspace. We will create a dedicated workspace with the full BL-18 input/output flow, mock generation, simulated downloads, and a client-side audit log — matching the existing glass-morphism design system and EN/RU i18n.

**Key architectural decisions:**

- A new `#letter-workspace` div (sibling to `#tool-workspace`) with its own HTML, CSS, and JS, so existing tools continue to use the generic workspace unchanged.
- The `openWorkspace` router is modified so that clicking the letters card opens `#letter-workspace` instead of `#tool-workspace`; all other tools remain unaffected.
- Downloads are pure client-side Blob-based (mock DOCX content as `.docx`, mock ZIP content as `.zip`); no real document assembly.
- Signatory placeholders (`{{SIGNATORY_NAME}}`, `{{SIGNATORY_TITLE}}`) are shown verbatim in the mock result to demonstrate the spec requirement.
- Template DOCX is never "sent to LLM" — the mock processing explicitly skips it and only uses the text content (demonstrated in the simulated flow and noted in the audit log).
- All new i18n keys are added to the `translations.ru` object; EN text is the inline default in HTML attributes.

**Assumptions:**

1. "Mock generation" means a client-side setTimeout simulation (like the existing workspace) — no actual LLM call or DOCX manipulation.
2. The DOCX and ZIP downloads produce valid Blobs with placeholder text content; real binary DOCX/ZIP assembly is out of scope for the landing-page demo.
3. The audit log is a client-side in-memory array displayed in a scrollable panel, reset on workspace close.
4. No backend, no persistence, no real file processing.

---

## Phase 1 — Dedicated workspace skeleton and routing

- **phase_id:** `BL18-P1`
- **title:** Letter workspace HTML/CSS skeleton and card routing
- **goal:** Create the structural shell for the letter generator workspace and wire the letters card to open it instead of the generic workspace. After this phase the dedicated workspace opens/closes correctly, displays placeholder step headings, and matches the existing design system.
- **scope:**
  - New `<div id="letter-workspace">` HTML block (sibling of `#tool-workspace`) with: header (title + close button), 4 content areas as step placeholders (template upload, letter content, attachments, generation/result), wrapped in `.letter-workspace-inner`.
  - CSS for `.letter-workspace`, reusing existing CSS variables (`--bg-void`, `--bg-card`, `--glass-bg`, `--border`, `--cyan`, `--text-bright`, `--accent-gradient`, etc.) and following the glass-morphism pattern of `.tool-workspace`.
  - JS routing change: when `toolId === 'letters'`, open `#letter-workspace` instead of `#tool-workspace`; close handler and Escape key support for the new workspace.
  - New i18n keys (`letters.ws.*`) added to the `translations.ru` object for all step headings and labels used in this phase.
  - Ensure `body.workspace-active` class (or a parallel `body.letter-workspace-active` class) is toggled so scroll lock works.
- **out_of_scope:**
  - Functional inputs (file upload, textarea, validation) — Phase 2.
  - Generation logic, downloads, audit log — Phase 3.
  - Changes to the generic workspace HTML/CSS/JS.
- **dependencies:** None (first phase).
- **files_or_areas:**
  - `index.html` — HTML (new `#letter-workspace` div after `#tool-workspace`), CSS (new rules in `<style>`), JS (routing change in the `openWorkspace` / `closeWorkspace` section, new i18n keys in `translations.ru`).
- **acceptance_criteria:**
  1. Clicking the "Official letters" tool card opens the dedicated `#letter-workspace` (not the generic workspace).
  2. Clicking close or pressing Escape closes the letter workspace and returns to the landing page.
  3. All other tool cards (audit, tasks, meeting, wbs) still open the generic `#tool-workspace` as before.
  4. The letter workspace displays the tool title ("Official letters" / "Официальные письма") and 4 step headings matching the current language.
  5. Switching language (EN↔RU) while the letter workspace is open updates all visible strings.
  6. The visual style (background, borders, typography, spacing) is consistent with the existing generic workspace.
- **testing_scenario:**
  - **Setup:** Serve `index.html` locally (`python3 -m http.server 8080`), open in browser.
  - **Actions:**
    1. Click any non-letters active tool card (e.g. "Project plan audit") → verify the generic workspace opens with the correct title.
    2. Close it. Click "Official letters" → verify the new dedicated workspace opens, NOT the generic one. Verify step headings are visible.
    3. Toggle language to RU → verify all step headings switch to Russian. Toggle back to EN → verify English text.
    4. Press Escape → verify workspace closes, landing page is visible and scrollable.
    5. Re-open letters workspace, click the close (×) button → verify it closes.
    6. Open a non-letters tool, then close, then open letters → verify no ghost state from the generic workspace leaks.
  - **Expected result:** All 6 checks pass; no console errors.
  - **Evidence:** Screenshots of: (a) letters workspace open in EN, (b) letters workspace open in RU, (c) generic workspace open for another tool (proving no regression).
- **status:** `verified`
- **verified_date:** 2026-05-24
- **verified_by:** Verifier (computerUse subagent, 9 test scenarios)
- **PR:** [#22](https://github.com/Plaxotin/AI-PMO/pull/22) — merged 2026-05-25

---

## Phase 2 — Input form with file validation and i18n

- **phase_id:** `BL18-P2`
- **title:** Template upload, letter content textarea, attachments, and template passport inputs
- **goal:** Implement the complete input side of the letter generator: the user can upload a DOCX template, type the letter content, optionally add up to 5 attachments with format/size validation, and optionally fill in a template passport field. All validation errors are shown inline. After this phase the workspace accepts all user input but does not yet process or produce output.
- **scope:**
  - **Template upload zone** (Step 1): drag-and-drop / click-to-browse file input. Validation: accept only `.docx`, reject others with inline error; reject files > 10 MB with size-limit error. Display selected filename + size after valid selection. Allow re-selection.
  - **Letter content textarea** (Step 2): `<textarea>` with placeholder hint "Опишите суть письма на русском языке…" / "Describe the letter content in Russian…". No hard validation on language (spec says heuristic is enough for MVP; for the landing demo a soft visual hint is sufficient).
  - **Attachments zone** (Step 3): multi-file input, max 5 files. Accept `.xlsx`, `.docx`, `.pdf`. Each file ≤ 10 MB. Show list of selected files with remove buttons. Show inline errors for invalid type or size. Show count indicator (e.g. "3 / 5 files").
  - **Template passport** (Step 4): optional `<textarea>` with placeholder "Short description of template style (optional)" / Russian equivalent. Character count indicator.
  - All labels, placeholders, error messages, and hints have corresponding i18n keys added to `translations.ru`.
  - A "Generate letter" button at the bottom, visually present but **disabled** until at least the template and letter content are provided.
  - Responsive layout: inputs stack vertically on mobile; on wider screens the template upload and attachments can sit side-by-side if space allows.
- **out_of_scope:**
  - The generate button's click handler (processing logic) — Phase 3.
  - Download buttons, result display, audit log — Phase 3.
  - Real file content reading or DOCX parsing.
- **dependencies:** `BL18-P1` (workspace skeleton must exist).
- **files_or_areas:**
  - `index.html` — HTML (form elements inside `#letter-workspace`), CSS (upload zone, textarea, file list, error styles), JS (file input handlers, validation logic, attachment list management, i18n refresh), `translations.ru` (new keys).
- **acceptance_criteria:**
  1. Selecting a `.docx` file ≤ 10 MB in the template zone shows the filename; selecting a `.pdf` or `.txt` shows an inline error "Only .docx files are accepted" (localized).
  2. Selecting a file > 10 MB shows an inline error "File exceeds 10 MB limit" (localized).
  3. Typing text into the letter content textarea enables that field visually; clearing it shows the placeholder again.
  4. Uploading 1–5 valid attachment files shows them in a list with remove buttons. Uploading a 6th file shows a "Maximum 5 attachments" error (localized). Invalid types/sizes are rejected per-file with specific errors.
  5. Removing an attachment from the list updates the count and allows adding a replacement.
  6. The "Generate letter" button is disabled when template or letter content is empty; enabled when both are provided.
  7. The template passport field is optional and does not affect the generate button state.
  8. All new UI text switches correctly between EN and RU.
  9. On mobile viewport (≤ 480px) all inputs are full-width and usable.
- **testing_scenario:**
  - **Setup:** Serve locally, open letters workspace in browser. Prepare test files: `valid.docx` (small, < 1 MB), `big.docx` (> 10 MB if possible, otherwise rename any large file), `wrong.pdf`, `attachment.xlsx`, `attachment.pdf`, `attachment.docx`.
  - **Actions:**
    1. In template zone, select `wrong.pdf` → verify error message appears, no file shown.
    2. Select `valid.docx` → verify filename + size displayed, error clears.
    3. Check "Generate letter" button is still disabled (no letter content yet).
    4. Type text in letter content textarea → verify button becomes enabled.
    5. Clear textarea → verify button becomes disabled again. Retype.
    6. In attachments zone, add 3 valid files → verify list shows 3 items with names and remove buttons.
    7. Try to add 3 more files → verify only 2 are accepted (reaching 5 total) and a "max 5" error is shown for the rest.
    8. Remove one attachment → verify count updates to 4 and adding 1 more works.
    9. Type a short text in template passport.
    10. Toggle language → verify all labels, placeholders, and error messages switch.
    11. Resize browser to mobile width → verify layout is usable.
  - **Expected result:** All 11 checks pass; no console errors; button state is always correct.
  - **Evidence:** Screenshots of: (a) validation error on wrong file type, (b) valid template selected + content entered + attachments listed, (c) RU language state, (d) mobile layout.
- **status:** `verified`
- **verified_date:** 2026-05-24
- **verified_by:** Verifier (computerUse subagent, 9 test scenarios)
- **PR:** [#22](https://github.com/Plaxotin/AI-PMO/pull/22) — merged 2026-05-25

---

## Phase 3 — Mock generation, simulated downloads, and audit log

- **phase_id:** `BL18-P3`
- **title:** Simulated letter generation, DOCX/ZIP download buttons, and client-side audit log
- **goal:** Complete the letter generator workspace by wiring the "Generate" button to a mock processing flow, displaying a result panel with a letter preview (including signatory placeholders), two download buttons (DOCX and ZIP), and a collapsible audit log panel. After this phase the entire BL-18 feature flow is demonstrable end-to-end.
- **scope:**
  - **Generate button handler:** on click, show a processing state (spinner, disabled button, "Generating…" label) for ~2–3 seconds (simulated), then reveal the result section.
  - **Result section:**
    - Mock letter preview in a styled read-only panel, showing: subject line, greeting ("Уважаемый…"), body text derived from user input, attachments list (from uploaded filenames), signatory block with literal `{{SIGNATORY_NAME}}` and `{{SIGNATORY_TITLE}}` placeholders.
    - **"Download DOCX" button:** creates a Blob with the mock letter text content (plain text with `.docx` extension and MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document`), triggers browser download as `letter.docx`.
    - **"Download ZIP" button:** creates a Blob with a simple text representation (plain text with `.zip` extension — real ZIP binary assembly is not required for landing demo; alternatively if feasible without dependencies, a minimal ZIP can be assembled using the existing `Blob` API). Triggers download as `letter-package.zip`. The simulated content includes a note listing the files that would be in the package (`letter.docx` + attachment filenames).
    - Visual note below downloads: "Template was not sent to LLM — only your text content was used" (per spec §2, §6), localized.
  - **Audit log panel:**
    - Collapsible section at the bottom of the result area, default collapsed with a toggle ("Show audit log" / "Hide audit log").
    - Displays a table/list of mock audit entries with fields from spec §8: `timestamp` (current time in UTC+3/MSK format), `user_id` (mock: "demo-user"), `template_id` (mock UUID), `request_id` (mock UUID), `model_id` ("mock-llm-v1"), `attachment_count`, `attachment_names`, `zip_issued` (boolean, true).
    - Each generation adds a new entry (in-memory array, cleared on workspace close).
  - **Reset behavior:** clicking "Generate" again (after changing inputs) adds a new audit entry and refreshes the result.
  - **All new strings** localized with i18n keys in both EN and RU.
- **out_of_scope:**
  - Real DOCX assembly (docxtpl or similar) — this is a landing-page demo.
  - Real ZIP binary creation with actual file contents (a text placeholder is acceptable).
  - Backend API calls, LLM integration, persistent storage.
  - Signatory auto-fill (explicitly forbidden in spec §5).
  - Approval workflows, versioning, email export (spec §3.2).
- **dependencies:** `BL18-P2` (input form must be functional).
- **files_or_areas:**
  - `index.html` — HTML (result section, download buttons, audit log panel inside `#letter-workspace`), CSS (result panel, preview styles, download button styles, audit table styles, collapse animation), JS (generate handler, Blob download logic, audit log array/render, collapse toggle, i18n refresh for result area), `translations.ru` (new keys).
- **acceptance_criteria:**
  1. With a valid template and letter content, clicking "Generate letter" shows a spinner/progress for ~2–3 s, then displays the result section.
  2. The mock letter preview contains: a subject line, greeting, body reflecting user input, an "Attachments:" list matching uploaded filenames (or "None" if no attachments), and signatory placeholders `{{SIGNATORY_NAME}}` / `{{SIGNATORY_TITLE}}` shown literally (not filled in).
  3. "Download DOCX" triggers a browser download of `letter.docx` containing text content.
  4. "Download ZIP" triggers a browser download of `letter-package.zip` (or a simulated file).
  5. A note stating the template was not sent to LLM is visible in the result section.
  6. The audit log toggle expands/collapses the log panel.
  7. After generation, the audit log shows one entry with the correct fields (timestamp, user, template id, request id, attachment count/names, zip_issued = true).
  8. Generating a second time (e.g. after editing the content) adds a second entry to the audit log.
  9. Closing and reopening the workspace resets all state (inputs, result, audit log).
  10. All new text is correctly localized when switching EN↔RU, including the result section and audit log labels.
  11. The entire end-to-end flow works: open workspace → upload template → enter content → add attachments → optionally fill passport → generate → see preview → download DOCX → download ZIP → view audit log → close.
- **testing_scenario:**
  - **Setup:** Serve locally, open letters workspace. Prepare: `template.docx` (any small .docx), 2 attachment files (`report.xlsx`, `note.pdf`).
  - **Actions:**
    1. Upload `template.docx` in the template zone.
    2. Type "Просим предоставить документы по проекту N до конца месяца." in the letter content textarea.
    3. Upload `report.xlsx` and `note.pdf` as attachments.
    4. Type "Formal corporate style, government agency" in the template passport.
    5. Click "Generate letter" → verify spinner appears, button is disabled.
    6. Wait for result → verify the letter preview appears with: subject, greeting, body containing the user's text (or a mock transformation of it), "Attachments: report.xlsx, note.pdf" list, and `{{SIGNATORY_NAME}}` / `{{SIGNATORY_TITLE}}` placeholders.
    7. Verify the "template not sent to LLM" note is visible.
    8. Click "Download DOCX" → verify `letter.docx` download starts.
    9. Click "Download ZIP" → verify `letter-package.zip` download starts.
    10. Click "Show audit log" → verify the log panel expands with one entry showing timestamp, user, template_id, request_id, 2 attachments, zip_issued=true.
    11. Change the letter content text, click "Generate letter" again → verify result updates and a second audit entry appears.
    12. Switch to RU → verify all result section text, download button labels, audit log headers, and the LLM note are in Russian.
    13. Close workspace → reopen → verify all state is reset (no result, no audit entries, empty inputs).
    14. Verify no console errors throughout.
  - **Expected result:** All 14 checks pass; downloads trigger; audit log accurately reflects each generation.
  - **Evidence:** Screenshots of: (a) result panel with letter preview and signatory placeholders, (b) downloads folder showing downloaded files, (c) expanded audit log with entries, (d) RU language state of the result section. Optionally a screen recording of the full end-to-end flow.
- **status:** `verified`
- **verified_date:** 2026-05-24
- **verified_by:** Verifier (computerUse subagent, 9 test scenarios + video recording)
- **PR:** [#22](https://github.com/Plaxotin/AI-PMO/pull/22) — merged 2026-05-25

---

## Open questions — resolved

1. **Mock DOCX content format:** Resolved — plain text with `.docx` MIME type. Sufficient for landing-page demo.
2. **Mock ZIP content:** Resolved — implemented a minimal uncompressed ZIP builder in ~50 lines of JS (no external dependencies). ZIP files are valid and can be extracted by standard archivers.
3. **Collision handling in attachment names:** Resolved — implemented suffix `_2`, `_3`, etc. approach per spec recommendation.

---

## Defects found and fixed

1. **EN error messages showed raw i18n keys** — dynamic error strings (e.g. "Only .docx files are accepted") had no DOM counterparts for the EN fallback path. Fixed by adding `enFallback` dictionary in the letter workspace JS. Commit `3f6869f`.

---

## Deployment

- **Production URL:** https://ai-pmo-tawny.vercel.app
- **Vercel status:** SUCCESS
- **To test:** open the URL → scroll to "Tools" section → click "Official letters" card
