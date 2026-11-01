import { type Browser, expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'latex-cloud-dev-password';

/** Signs in a fresh browser context and waits until the app has hydrated. */
export async function newSession(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('current-user')).toBeVisible();
  return page;
}

/** Creates a project from the dashboard and waits for the editor to open main.tex. */
export async function createProject(page: Page, name: string, template?: string): Promise<string> {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  if (template) await dialog.getByLabel('Template').selectOption(template);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('project-name')).toHaveText(name);
  await expect(page.locator('.cm-content')).toBeVisible();
  return page.url().split('/').pop()!;
}

/** Reads a file's server-side content through the API with the page's session. */
export async function serverContent(page: Page, projectId: string, path: string): Promise<string> {
  const list = await (await page.request.get(`/api/v1/projects/${projectId}/files`)).json();
  const file = list.files.find((f: { path: string }) => f.path === path);
  const res = await page.request.get(`/api/v1/projects/${projectId}/files/${file.id}`);
  return (await res.json()).content;
}
