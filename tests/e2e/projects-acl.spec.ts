import { expect, test } from '@playwright/test';
import { newSession } from './helpers';

test('create, rename, share as viewer, enforce viewer limits, delete', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const name = `E2E Topology ${stamp}`;
  const renamed = `E2E Topology (rev) ${stamp}`;

  // Alice creates a project from the dashboard and lands in the editor.
  const alice = await newSession(browser, 'alice@example.com');
  await alice.getByRole('button', { name: 'New project' }).click();
  const create = alice.getByRole('dialog', { name: 'New project' });
  await create.getByLabel('Project name', { exact: true }).fill(name);
  await create.getByLabel('Compiler').selectOption('xelatex');
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(alice.getByTestId('project-name')).toHaveText(name);
  await expect(alice.getByText('XeLaTeX')).toBeVisible();
  const projectUrl = alice.url();

  // Rename through settings.
  await alice.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = alice.getByRole('dialog', { name: 'Project settings' });
  await settings.getByLabel('Project name', { exact: true }).fill(renamed);
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByText('Saved.')).toBeVisible();
  await settings.getByRole('button', { name: 'Close dialog' }).click();
  await expect(alice.getByTestId('project-name')).toHaveText(renamed);

  // Invite Bob as a viewer.
  await alice.getByRole('button', { name: 'Share' }).click();
  const share = alice.getByRole('dialog', { name: /^Share/ });
  await share.getByLabel('Email').fill('bob@example.com');
  await share.getByLabel('Permission').selectOption('viewer');
  await share.getByRole('button', { name: 'Invite' }).click();
  await expect(share.getByTestId('member-row')).toHaveCount(2);
  await expect(share.getByTestId('member-row').filter({ hasText: 'Bob Tran' })).toBeVisible();

  // Duplicate invite is reported, not silently ignored.
  await share.getByLabel('Email').fill('bob@example.com');
  await share.getByRole('button', { name: 'Invite' }).click();
  await expect(share.getByText('already a member')).toBeVisible();
  await share.getByRole('button', { name: 'Close dialog' }).click();

  // Bob sees it as a viewer and cannot change settings or manage members.
  const bob = await newSession(browser, 'bob@example.com');
  const bobRow = bob.getByTestId('project-row').filter({ hasText: renamed });
  await expect(bobRow).toContainText('viewer');
  await bobRow.click();
  await bob.getByRole('button', { name: 'Settings', exact: true }).click();
  const bobSettings = bob.getByRole('dialog', { name: 'Project settings' });
  await expect(bobSettings.getByLabel('Project name', { exact: true })).toBeDisabled();
  await expect(bobSettings.getByRole('button', { name: 'Delete project' })).toHaveCount(0);
  await bobSettings.getByRole('button', { name: 'Close dialog' }).click();
  await bob.getByRole('button', { name: 'Share' }).click();
  await expect(bob.getByRole('button', { name: 'Invite' })).toHaveCount(0);
  await bob.keyboard.press('Escape');

  // Alice deletes it (name confirmation required).
  await alice.getByRole('button', { name: 'Settings', exact: true }).click();
  const danger = alice.getByRole('dialog', { name: 'Project settings' });
  const del = danger.getByRole('button', { name: 'Delete project' });
  await expect(del).toBeDisabled();
  await danger.getByLabel('Confirm project name').fill(renamed);
  await del.click();
  await expect(alice).toHaveURL(/\/projects$/);
  await expect(alice.getByText(renamed)).toHaveCount(0);

  // Gone for Bob too.
  await bob.goto('/projects');
  await expect(bob.getByTestId('project-row').first()).toBeVisible();
  await expect(bob.getByText(renamed)).toHaveCount(0);
  await bob.goto(projectUrl);
  await expect(bob.getByText('Project not found')).toBeVisible();
});

test('members can leave a shared project', async ({ browser }) => {
  const name = `E2E Leave ${Date.now().toString(36)}`;
  const alice = await newSession(browser, 'alice@example.com');
  await alice.getByRole('button', { name: 'New project' }).click();
  await alice
    .getByRole('dialog', { name: 'New project' })
    .getByLabel('Project name', { exact: true })
    .fill(name);
  await alice.getByRole('button', { name: 'Create project' }).click();
  await expect(alice.getByTestId('project-name')).toHaveText(name);
  await alice.getByRole('button', { name: 'Share' }).click();
  await alice.getByLabel('Email').fill('bob@example.com');
  await alice.getByRole('button', { name: 'Invite' }).click();
  await expect(alice.getByTestId('member-row')).toHaveCount(2);

  const bob = await newSession(browser, 'bob@example.com');
  await bob.getByTestId('project-row').filter({ hasText: name }).click();
  await bob.getByRole('button', { name: 'Share' }).click();
  await bob.getByRole('button', { name: 'Leave' }).click();
  await expect(bob).toHaveURL(/\/projects$/);
  await expect(bob.getByText(name)).toHaveCount(0);
});
