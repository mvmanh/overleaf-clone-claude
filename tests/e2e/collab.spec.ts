import { expect, type Page, test } from '@playwright/test';
import { createProject, newSession, serverContent } from './helpers';

test.describe.configure({ timeout: 90_000 });

const stamp = () => Date.now().toString(36);
const editor = (page: Page) => page.locator('.cm-content');

/** The whole document (the DOM only holds the lines in view). */
const docText = (page: Page) =>
  page.locator('.cm-content').evaluate((el) => {
    type View = { state: { doc: { toString(): string } } };
    const tile = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile;
    return tile!.root!.view!.state.doc.toString();
  });

/** Polls until the page's document contains (or lacks) `text`. */
async function expectDoc(page: Page, text: string, { not = false, timeout = 10_000 } = {}) {
  const check = expect.poll(() => docText(page), { timeout });
  if (not) await check.not.toContain(text);
  else await check.toContain(text);
}

/** Calls the API with the page's session (state-changing calls need the Origin header). */
async function apiCall(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
) {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { Origin: origin },
    ...(data ? { data } : {}),
  });
  expect(res.ok(), `${method} ${path}: ${res.status()}`).toBeTruthy();
  return res;
}

async function invite(owner: Page, projectId: string, email: string, role: 'editor' | 'viewer') {
  await apiCall(owner, 'POST', `/projects/${projectId}/members/invite`, { email, role });
}

/** Deletes a test project so seeded users' dashboards stay as the other suites expect. */
async function cleanup(owner: Page, projectId: string) {
  await apiCall(owner, 'DELETE', `/projects/${projectId}`);
}

async function openProject(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`);
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('source-editor')).toHaveAttribute('data-mode', 'collab');
}

/** Types at the end of the document from a fresh line. */
async function typeAtEnd(page: Page, text: string) {
  await editor(page).click();
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`\n${text}`);
}

async function typeAtStart(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type(`${text}\n`);
}

test('editing together: live text, cursors, presence and read-only viewers', async ({
  browser,
}) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Collab ${stamp()}`, 'math');
  await invite(alice, id, 'bob@example.com', 'editor');
  await invite(alice, id, 'carol@example.com', 'viewer');
  const bob = await newSession(browser, 'bob@example.com');
  const carol = await newSession(browser, 'carol@example.com');
  await openProject(alice, id);
  await openProject(bob, id);
  await openProject(carol, id);

  // Presence: everyone else shows up as an avatar with their name…
  const avatars = alice.getByTestId('presence-avatar');
  await expect(avatars).toHaveCount(2);
  await expect(alice.getByRole('button', { name: /Bob Tran, editing main\.tex/ })).toBeVisible();
  await expect(alice.getByRole('button', { name: /Carol Le, editing main\.tex/ })).toBeVisible();
  // …and as coloured dots on the file they have open.
  await expect(
    alice.getByTestId('file-row').filter({ hasText: 'main.tex' }).getByTestId('tree-editors'),
  ).toBeVisible();

  // Edits appear for everyone, in both directions.
  await typeAtEnd(alice, '% from alice');
  await expectDoc(bob, '% from alice');
  await expectDoc(carol, '% from alice');
  await typeAtStart(bob, '% from bob');
  await expectDoc(alice, '% from bob');

  // Collaborators' cursors carry their names.
  await expect(alice.locator('.cm-ySelectionInfo', { hasText: 'Bob Tran' })).toBeVisible();

  // Simultaneous typing in different places converges without losing text.
  await Promise.all([typeAtEnd(alice, '% alice again'), typeAtStart(bob, '% bob again')]);
  for (const page of [alice, bob, carol]) {
    await expectDoc(page, '% alice again');
    await expectDoc(page, '% bob again');
  }
  await expect(alice.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await expect(bob.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  const stored = await serverContent(alice, id, 'main.tex');
  for (const line of ['% from alice', '% from bob', '% alice again', '% bob again'])
    expect(stored).toContain(line);
  await expect.poll(async () => (await docText(alice)) === (await docText(bob))).toBe(true);

  // The viewer follows along but cannot type.
  await expect(editor(carol)).toHaveAttribute('contenteditable', 'false');
  await editor(carol).click();
  await carol.keyboard.type('vandalism');
  await carol.waitForTimeout(500);
  await expectDoc(carol, 'vandalism', { not: true });
  await expectDoc(alice, 'vandalism', { not: true });

  // Ctrl+Z only undoes your own change, never a collaborator's.
  await typeAtEnd(bob, '% bob undoes this');
  await expectDoc(alice, '% bob undoes this');
  await bob.keyboard.press('Control+z');
  await expectDoc(alice, '% bob undoes this', { not: true });
  await expectDoc(bob, '% from alice');
  await cleanup(alice, id);
});

test('edits made offline are kept and merged on reconnect', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Offline ${stamp()}`);
  await invite(alice, id, 'bob@example.com', 'editor');
  const bob = await newSession(browser, 'bob@example.com');
  await openProject(alice, id);
  await openProject(bob, id);
  await expect(alice.getByTestId('presence-avatar')).toHaveCount(1);

  await bob.context().setOffline(true);
  await expect(bob.getByTestId('save-status')).toHaveText('Offline · edits kept', {
    timeout: 15_000,
  });
  await typeAtEnd(bob, '% written offline');
  await typeAtStart(alice, '% written online');
  await expectDoc(bob, '% written online', { not: true });

  await bob.context().setOffline(false);
  await expectDoc(bob, '% written online', { timeout: 20_000 });
  await expectDoc(alice, '% written offline');
  await expect(bob.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  const stored = await serverContent(alice, id, 'main.tex');
  expect(stored).toContain('% written offline');
  expect(stored).toContain('% written online');
  await cleanup(alice, id);
});

test('a file deleted while someone edits it keeps their text', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Deleted ${stamp()}`);
  await invite(alice, id, 'bob@example.com', 'editor');
  const files = await (await alice.request.get(`/api/v1/projects/${id}/files`)).json();
  const created = await apiCall(alice, 'POST', `/projects/${id}/files`, {
    path: 'notes.tex',
    content: 'shared notes\n',
  });
  const notes = await created.json();
  expect(files.files.length).toBeGreaterThan(0);

  const bob = await newSession(browser, 'bob@example.com');
  await openProject(bob, id);
  await bob.getByTestId('file-row').filter({ hasText: 'notes.tex' }).click();
  await expectDoc(bob, 'shared notes');
  await typeAtEnd(bob, 'bob was still writing');
  await expect(bob.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await apiCall(alice, 'DELETE', `/projects/${id}/files/${notes.id}`);
  const banner = bob.getByTestId('file-deleted-banner');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expectDoc(bob, 'bob was still writing');
  await expect(editor(bob)).toHaveAttribute('contenteditable', 'false');
  await expect(bob.getByTestId('file-row').filter({ hasText: 'notes.tex' })).toHaveCount(0);

  await banner.getByRole('button', { name: 'Save as new file' }).click();
  await expect(bob.locator('.panel__path')).toHaveText('notes-recovered.tex');
  await expectDoc(bob, 'bob was still writing');
  expect(await serverContent(alice, id, 'notes-recovered.tex')).toContain('bob was still writing');
  await cleanup(alice, id);
});

test('a role change applies to an open editor immediately', async ({ browser }) => {
  const alice = await newSession(browser, 'alice@example.com');
  const id = await createProject(alice, `E2E Roles ${stamp()}`);
  await invite(alice, id, 'bob@example.com', 'editor');
  const bob = await newSession(browser, 'bob@example.com');
  await openProject(bob, id);
  await expect(editor(bob)).toHaveAttribute('contenteditable', 'true');

  const members = await (await alice.request.get(`/api/v1/projects/${id}/members`)).json();
  const bobId = members.members.find(
    (m: { email: string }) => m.email === 'bob@example.com',
  ).userId;
  await apiCall(alice, 'PATCH', `/projects/${id}/members/${bobId}`, { role: 'viewer' });
  await expect(editor(bob)).toHaveAttribute('contenteditable', 'false', { timeout: 10_000 });
  await expect(bob.getByText('read-only')).toBeVisible();
  await cleanup(alice, id);
});
