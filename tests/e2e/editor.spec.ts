import { expect, test } from '@playwright/test';
import { createProject, newSession, serverContent } from './helpers';

const stamp = () => Date.now().toString(36);

test('write LaTeX with autosave; reload keeps it', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Editor ${stamp()}`, 'math');
  await expect(alice.locator('.cm-line').first()).toContainText('\\documentclass[11pt]{amsart}');

  await alice.locator('.cm-content').click();
  await alice.keyboard.press('Control+End');
  await alice.keyboard.type('\n% autosaved line');
  await expect(alice.getByTestId('save-status')).toHaveText('Unsaved changes');
  await expect(alice.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  expect(await serverContent(alice, id, 'main.tex')).toContain('% autosaved line');

  // Ctrl+S saves immediately.
  await alice.keyboard.type('\n% saved with ctrl-s');
  await alice.keyboard.press('Control+s');
  await expect(alice.getByTestId('save-status')).toHaveText('Saved');
  expect(await serverContent(alice, id, 'main.tex')).toContain('% saved with ctrl-s');
});

test('file tree: create in a folder, rename, set as main, delete', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Tree ${stamp()}`);

  await alice.getByRole('button', { name: 'New file' }).click();
  await alice
    .getByRole('dialog', { name: 'New file' })
    .getByLabel('Path')
    .fill('chapters/intro.tex');
  await alice.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'chapters' })).toBeVisible();
  await expect(alice.getByTestId('file-row').filter({ hasText: 'intro.tex' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(alice.locator('.panel__path')).toHaveText('chapters/intro.tex');

  await alice.locator('.cm-content').click();
  await alice.keyboard.type('Introduction text.');
  await alice.getByRole('button', { name: 'Rename' }).click(); // flushes the pending save first
  const rename = alice.getByRole('dialog', { name: 'Rename file' });
  await rename.getByLabel('Path').fill('chapters/introduction.tex');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(alice.getByTestId('file-row').filter({ hasText: 'introduction.tex' })).toBeVisible();
  expect(await serverContent(alice, id, 'chapters/introduction.tex')).toBe('Introduction text.');

  await alice.getByRole('button', { name: 'Set as main' }).click();
  await expect(alice.getByTestId('file-row').filter({ hasText: 'introduction.tex' })).toContainText(
    'main',
  );

  // main.tex is no longer the root, so it can be deleted.
  await alice
    .getByTestId('file-row')
    .filter({ hasText: /^Tmain\.tex$/ })
    .click();
  await alice.getByRole('button', { name: 'Delete' }).click();
  await alice
    .getByRole('dialog', { name: 'Delete file?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(alice.getByTestId('file-row')).toHaveCount(1);

  // Invalid paths are explained, not silently accepted.
  await alice.getByRole('button', { name: 'New file' }).click();
  const create = alice.getByRole('dialog', { name: 'New file' });
  await create.getByLabel('Path').fill('../escape.tex');
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(create.getByRole('alert')).toBeVisible();
});

test('viewers get a read-only editor', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const name = `E2E Readonly ${stamp()}`;
  const id = await createProject(alice, name);
  await alice.getByRole('button', { name: 'Share' }).click();
  await alice.getByLabel('Email').fill('bob@example.com');
  await alice.getByLabel('Permission').selectOption('viewer');
  await alice.getByRole('button', { name: 'Invite' }).click();
  await expect(alice.getByTestId('member-row')).toHaveCount(2);

  const bob = await newSession(browser, 'bob@example.com');
  await bob.goto(`/projects/${id}`);
  await expect(bob.locator('.cm-content')).toBeVisible();
  await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(bob.getByText('read-only')).toBeVisible();
  await expect(bob.getByRole('button', { name: 'New file' })).toHaveCount(0);
});

test('concurrent edits in two tabs surface a conflict instead of overwriting', async ({
  browser,
}) => {
  const tab1 = await newSession(browser, 'alice@example.com');
  const id = await createProject(tab1, `E2E Conflict ${stamp()}`, 'blank');
  const tab2 = await newSession(browser, 'alice@example.com');
  await tab2.goto(`/projects/${id}`);
  await expect(tab2.locator('.cm-content')).toBeVisible();

  await tab1.locator('.cm-content').click();
  await tab1.keyboard.type('% from tab 1');
  await tab1.keyboard.press('Control+s');
  await expect(tab1.getByTestId('save-status')).toHaveText('Saved');

  await tab2.locator('.cm-content').click();
  await tab2.keyboard.type('% from tab 2');
  await tab2.keyboard.press('Control+s');
  await expect(tab2.getByTestId('save-status')).toHaveText('Conflict');
  await expect(tab2.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toBeVisible();
  expect(await serverContent(tab2, id, 'main.tex')).toContain('% from tab 1');

  await tab2.getByRole('button', { name: 'Keep my version' }).click();
  await expect(tab2.getByTestId('save-status')).toHaveText('Saved');
  expect(await serverContent(tab2, id, 'main.tex')).toContain('% from tab 2');
});
