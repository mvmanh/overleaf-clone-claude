import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { createProject, newSession } from './helpers';

test.describe.configure({ timeout: 90_000 });

const suggestions = (page: Page) => page.locator('.cm-tooltip-autocomplete li');
const editor = (page: Page) => page.locator('.cm-content');

/** Accepts the highlighted suggestion (after CodeMirror's short interaction delay, like a person would). */
async function accept(page: Page, key: 'Enter' | 'Tab' = 'Enter') {
  await page.waitForTimeout(150);
  await page.keyboard.press(key);
}

/** Opens a fresh line at the end of the document. */
async function newLine(page: Page) {
  await page.locator('.cm-content').click();
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
}

test('citations, cross-file references and file names are suggested', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  await createProject(page, `E2E Suggest ${Date.now().toString(36)}`, 'cs');

  // \cite{ lists keys from references.bib with author and year…
  await newLine(page);
  await page.keyboard.type('See \\cite{');
  await expect(suggestions(page).first()).toContainText('knuth1998');
  await expect(suggestions(page).first()).toContainText('Knuth, 1998');
  // …and searches titles too.
  await page.keyboard.type('sorting');
  await expect(suggestions(page)).toHaveCount(1);
  await expect(page.locator('.cm-completionInfo')).toContainText('Sorting and Searching');
  await accept(page);
  await expect(editor(page)).toContainText('See \\cite{knuth1998}');

  // \cref{ lists labels from this file.
  await page.keyboard.press('End');
  await page.keyboard.type(' and \\cref{');
  await expect(suggestions(page).filter({ hasText: 'alg:bsearch' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A label in another file becomes available after it is created there.
  await page.getByRole('button', { name: 'New file' }).click();
  await page.getByRole('dialog', { name: 'New file' }).getByLabel('Path').fill('intro.tex');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('\\section{Intro}\\label{sec:intro}');
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await page.getByTestId('file-row').filter({ hasText: 'main.tex' }).click();
  await newLine(page);
  await page.keyboard.type('\\ref{');
  const intro = suggestions(page).filter({ hasText: 'sec:intro' });
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('intro.tex:1');
  await page.keyboard.press('Escape');

  // \includegraphics{ offers uploaded images only.
  await page.getByTestId('upload-input').setInputFiles({
    name: 'plot.png',
    mimeType: 'image/png',
    buffer: readFileSync(join(__dirname, 'gradient.png')),
  });
  await expect(page.getByTestId('asset-preview')).toBeVisible();
  await page.getByTestId('file-row').filter({ hasText: 'main.tex' }).click();
  await newLine(page);
  await page.keyboard.type('\\includegraphics{');
  await expect(suggestions(page)).toHaveText([/plot\.png/]);
});

test('math typing: auto-expansion, fields, undo, preview, palette', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  await createProject(page, `E2E Math ${Date.now().toString(36)}`, 'blank');
  await newLine(page);

  await page.keyboard.type('$@a');
  await expect(editor(page)).toContainText('$\\alpha$');
  // Undo keeps what was typed.
  await page.keyboard.press('Control+z');
  await expect(editor(page)).toContainText('$@a$');
  // Redo. (Playwright sends Shift+z as a lowercase key, which a real browser
  // never does, so use Ctrl+Y here; real Ctrl/⌘+Shift+Z is handled by CodeMirror.)
  await page.keyboard.press('Control+y');
  await expect(editor(page)).toContainText('$\\alpha$');

  // // → \frac{}{} with Tab between fields; x1 → x_1; RR → \mathbb{R}
  await page.keyboard.type(' + //');
  await page.keyboard.type('x1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  await page.keyboard.type(' \\in RR');
  await expect(editor(page)).toContainText('$\\alpha + \\frac{x_1}{2} \\in \\mathbb{R}$');

  // Live preview renders while the cursor is inside the formula.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('math-preview').locator('.katex')).toBeVisible();

  // Symbol palette inserts at the cursor (wrapping in $…$ outside math).
  await page.keyboard.press('End');
  await page.keyboard.type(' text ');
  await page.getByTestId('palette-toggle').click();
  await page
    .getByTestId('symbol-palette')
    .getByPlaceholder(/Search symbols/)
    .fill('leq');
  await page.getByRole('button', { name: 'Insert \\leq', exact: true }).click();
  await expect(editor(page)).toContainText('text $\\leq$');
});

test('snippets, environments, shortcuts and checks while typing', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  await createProject(page, `E2E Snippets ${Date.now().toString(36)}`, 'blank');
  await newLine(page);

  // Word snippet at line start + Tab.
  await page.keyboard.type('fig');
  await expect(suggestions(page).filter({ hasText: 'Figure' }).first()).toBeVisible();
  await accept(page, 'Tab');
  await expect(page.locator('.cm-content')).toContainText('\\begin{figure}[htbp]');
  await expect(page.locator('.cm-content')).toContainText('\\label{fig:label}');
  await page.keyboard.press('Escape');

  // Enter after \begin{…} closes the environment.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('\\begin{itemize');
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('\\item one');
  await expect(page.locator('.cm-line').filter({ hasText: '\\item one' })).toHaveCount(1);
  await expect(page.locator('.cm-line').filter({ hasText: '\\end{itemize}' })).toHaveCount(1);

  // Ctrl+B wraps the selection.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('important');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+b');
  await expect(editor(page)).toContainText('\\textbf{important}');

  // Unknown references are flagged without compiling.
  await page.keyboard.press('End');
  await page.keyboard.type(' see \\ref{nowhere}');
  await expect(page.locator('.cm-lintRange-warning')).toBeVisible({ timeout: 5000 });

  // Help lists snippets and math expansions, searchable.
  await page.getByRole('button', { name: 'Help: shortcuts and snippets' }).click();
  const help = page.getByRole('dialog', { name: 'Help: shortcuts & snippets' });
  await help.getByLabel('Search help').fill('matrix');
  await expect(help.getByTestId('help-snippets')).toContainText('pmat');
  await help.getByRole('tab', { name: /Math auto-expansion/ }).click();
  await help.getByLabel('Search help').fill('frac');
  await expect(help.getByTestId('help-auto')).toContainText('//');
});
