import { expect, type Page, test } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'latex-cloud-dev-password';

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('API is ready (DB, migrations, Redis, object storage)', async ({ request }) => {
  const res = await request.get('/api/v1/health/ready');
  const body = await res.json();
  expect(body.status, JSON.stringify(body)).toBe('ready');
});

test('unauthenticated visitors are sent to sign-in', async ({ page }) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('wrong password shows an error and stays on sign-in', async ({ page }) => {
  await signIn(page, 'alice@example.com', 'definitely-wrong');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email or password is incorrect' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('alice sees only her seeded projects with correct roles and opens the editor shell', async ({
  page,
}) => {
  await signIn(page, 'alice@example.com');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('current-user')).toHaveText('Alice Nguyen');

  const rows = page.getByTestId('project-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Analytic Number Theory' })).toContainText('owner');
  await expect(rows.filter({ hasText: 'Graph Algorithms Paper' })).toContainText('viewer');
  await expect(page.getByText('Luận văn Thạc sĩ')).toHaveCount(0);

  await rows.filter({ hasText: 'Analytic Number Theory' }).click();
  await expect(page.getByTestId('project-name')).toHaveText(/Analytic Number Theory/);
  for (const panel of ['tree', 'source', 'pdf', 'issues']) {
    await expect(page.getByTestId(`panel-${panel}`)).toBeVisible();
  }
  // Compile is honestly disabled until the pipeline exists.
  await expect(page.getByRole('button', { name: 'Compile' })).toBeDisabled();

  // Keyboard-first: Alt+3 focuses the PDF panel; ? opens the shortcuts dialog.
  await page.keyboard.press('Alt+3');
  await expect(page.getByTestId('panel-pdf')).toBeFocused();
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('carol cannot open a project she is not a member of', async ({ page }) => {
  await signIn(page, 'carol@example.com');
  await expect(page.getByTestId('project-row')).toHaveCount(1);
  await page.goto('/projects/6f1d7c4e-0001-4a51-9b1e-5e3c1d000001');
  await expect(page.getByText('Project not found')).toBeVisible();
});

test('theme toggle switches to an explicit theme and persists', async ({ page }) => {
  await signIn(page, 'bob@example.com');
  await expect(page.getByTestId('current-user')).toBeVisible();
  const toggle = page.getByRole('button', { name: /^Theme:/ });
  await toggle.click(); // system -> light
  await toggle.click(); // light -> dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('sign out revokes the session', async ({ page }) => {
  await signIn(page, 'bob@example.com');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status()).toBe(401);
});
