import { expect, type Page, test } from '@playwright/test';
import { createProject, newSession, serverContent } from './helpers';

test.describe.configure({ timeout: 90_000 });

const stamp = () => Date.now().toString(36);

async function typeAtEnd(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`\n${text}`);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
}

test('history: label, see what changed, restore an older version', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E History ${stamp()}`);

  await typeAtEnd(alice, '% first draft of the conclusion');
  await alice.getByTestId('history-toggle').click();
  await expect(alice.getByTestId('history')).toBeVisible();

  // Label the current state; it checkpoints the edit just made.
  await alice.getByTestId('label-current').click();
  const dialog = alice.getByRole('dialog', { name: 'Label current version' });
  await dialog.getByLabel('Label').fill('First draft');
  await dialog.getByRole('button', { name: 'Add label' }).click();
  await expect(alice.getByTestId('history-label')).toContainText('First draft');

  // The newest version is selected; its diff shows the added line.
  const newest = alice.getByTestId('history-version').first();
  await expect(newest).toHaveAttribute('aria-selected', 'true');
  await expect(newest).toContainText('main.tex');
  await expect(newest).toContainText('Alice Nguyen');
  await expect(alice.getByTestId('diff')).toContainText('% first draft of the conclusion');
  await expect(alice.getByTestId('diff-summary')).toContainText('−0');

  // Keyboard: ↓ moves to the older (template) version.
  await newest.focus();
  await alice.keyboard.press('ArrowDown');
  const older = alice.getByTestId('history-version').nth(1);
  await expect(older).toHaveAttribute('aria-selected', 'true');
  await expect(older).toContainText('created');

  // Back in the editor, write more; then restore the labelled version.
  await alice.keyboard.press('Escape');
  await expect(alice.getByTestId('history')).toHaveCount(0);
  await typeAtEnd(alice, '% a paragraph we will regret');
  await alice.getByTestId('history-toggle').click();
  await alice.getByTestId('label-current').click();
  await alice
    .getByRole('dialog', { name: 'Label current version' })
    .getByLabel('Label')
    .fill('Regret');
  await alice.getByRole('button', { name: 'Add label' }).click();
  await expect(alice.getByTestId('history-label')).toHaveCount(2);

  // Select the "First draft" checkpoint (the version just below its label).
  const firstDraft = alice.getByTestId('history-version').filter({ hasText: 'edited' }).last();
  await firstDraft.click();
  await alice.getByRole('button', { name: 'Compare with current' }).click();
  await expect(alice.getByTestId('diff')).toContainText('% a paragraph we will regret');

  await alice.getByTestId('restore-version').click();
  await alice
    .getByRole('dialog', { name: 'Restore this version?' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(alice.getByRole('status').filter({ hasText: 'was restored' })).toBeVisible();
  await expect(alice.getByTestId('history-version').first()).toContainText('restored');
  await expect
    .poll(() => serverContent(alice, id, 'main.tex'))
    .not.toContain('% a paragraph we will regret');
  expect(await serverContent(alice, id, 'main.tex')).toContain('% first draft of the conclusion');

  // The open editor shows the restored text live.
  await alice.getByTestId('history-toggle').click();
  await alice.locator('.cm-content').click();
  await alice.keyboard.press('Control+End');
  await expect(alice.locator('.cm-content')).toContainText('% first draft of the conclusion');
  await expect(alice.locator('.cm-content')).not.toContainText('regret');

  await alice.request.fetch(`/api/v1/projects/${id}`, {
    method: 'DELETE',
    headers: { Origin: new URL(alice.url()).origin },
  });
});

test('history: a deleted file comes back from its history', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Undelete ${stamp()}`);
  await alice.getByRole('button', { name: 'New file' }).click();
  await alice.getByRole('dialog', { name: 'New file' }).getByLabel('Path').fill('appendix.tex');
  await alice.getByRole('button', { name: 'Create', exact: true }).click();
  await typeAtEnd(alice, 'Appendix text that must not be lost.');
  await alice.getByRole('button', { name: 'Delete' }).click();
  await alice
    .getByRole('dialog', { name: 'Delete file?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(alice.getByTestId('file-row').filter({ hasText: 'appendix.tex' })).toHaveCount(0);

  await alice.getByTestId('history-toggle').click();
  const deletion = alice.getByTestId('history-version').first();
  await expect(deletion).toContainText('deleted');
  await expect(alice.getByTestId('diff')).toContainText('Appendix text that must not be lost.');
  // Restoring the deletion brings the file back with its last text.
  await expect(alice.getByTestId('restore-version')).toHaveText('Restore deleted file');
  await alice.getByTestId('restore-version').click();
  await alice
    .getByRole('dialog', { name: 'Restore this version?' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await alice.getByRole('button', { name: 'Open appendix.tex' }).click();
  await expect(alice.getByTestId('file-row').filter({ hasText: 'appendix.tex' })).toBeVisible();
  await expect(alice.locator('.panel__path')).toHaveText('appendix.tex');
  await expect(alice.locator('.cm-content')).toContainText('Appendix text that must not be lost.');
  expect(await serverContent(alice, id, 'appendix.tex')).toContain(
    'Appendix text that must not be lost.',
  );

  await alice.request.fetch(`/api/v1/projects/${id}`, {
    method: 'DELETE',
    headers: { Origin: new URL(alice.url()).origin },
  });
});
