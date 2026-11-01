import { expect, test } from '@playwright/test';
import { createProject, newSession } from './helpers';

test.describe.configure({ timeout: 120_000 });

test('compile to PDF, see an error at its line, keep the last good PDF, fix and recompile', async ({
  browser,
}) => {
  const page = await newSession(browser, 'alice@example.com');
  await createProject(page, `E2E Compile ${Date.now().toString(36)}`, 'article');

  // First compile: a PDF appears in the viewer.
  await page.getByTestId('compile-button').click();
  await expect(page.getByTestId('compile-status')).toContainText('Compiled', { timeout: 90_000 });
  await expect(page.locator('.pdf__page').first()).toBeVisible();
  await expect(page.getByTestId('pdf-pages')).toHaveText(/^1 \/ \d+$/);

  // Break the document on a known line, compile with Ctrl+Enter from the editor.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.type('\n\\thiscommanddoesnotexist');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toContainText('Compile failed (1 error)', {
    timeout: 90_000,
  });
  const problem = page.getByTestId('problem').first();
  await expect(problem).toContainText('Undefined control sequence');
  await expect(problem).toContainText('main.tex:2');

  // The previous PDF stays, clearly marked.
  await expect(page.getByTestId('pdf-previous')).toBeVisible();
  await expect(page.locator('.pdf__page').first()).toBeVisible();

  // Click-to-line: the editor selects the offending line.
  await page.keyboard.press('Control+End');
  await problem.click();
  await expect(page.locator('.cm-activeLine')).toContainText('\\thiscommanddoesnotexist');

  // Raw log is available.
  await page.getByRole('tab', { name: 'Raw log' }).click();
  await expect(page.getByTestId('raw-log')).toContainText('Undefined control sequence');

  // Fix (delete the line) and recompile: success, banner gone.
  await page.locator('.cm-activeLine').click();
  await page.keyboard.press('Control+Shift+k'); // CodeMirror: delete line
  await expect(page.locator('.cm-content')).not.toContainText('thiscommanddoesnotexist');
  await page.getByTestId('compile-button').click();
  await expect(page.getByTestId('compile-status')).toContainText('Compiled', { timeout: 90_000 });
  await expect(page.getByTestId('pdf-previous')).toHaveCount(0);
});

test('compiling unchanged content is a cache hit', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  await createProject(page, `E2E Cache ${Date.now().toString(36)}`, 'blank');
  await page.getByTestId('compile-button').click();
  await expect(page.getByTestId('compile-status')).toContainText('Compiled', { timeout: 90_000 });
  await page.getByTestId('compile-button').click();
  await expect(page.getByTestId('compile-status')).toContainText('(cached)');
});
