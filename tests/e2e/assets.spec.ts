import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { createProject, newSession } from './helpers';

test.describe.configure({ timeout: 120_000 });

const PNG = readFileSync(join(__dirname, 'gradient.png'));

test('upload a PNG, include it, compile; preview and download ZIP', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  const projectId = await createProject(page, `E2E Figure ${Date.now().toString(36)}`, 'article');

  await page
    .getByTestId('upload-input')
    .setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: PNG });
  const row = page.getByTestId('file-row').filter({ hasText: 'gradient.png' });
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('asset-preview').locator('img')).toBeVisible();

  // Uploading the same name asks before replacing.
  await page
    .getByTestId('upload-input')
    .setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog', { name: 'Replace existing file?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep existing' }).click();

  // A spoofed image is rejected with an explanation.
  await page
    .getByTestId('upload-input')
    .setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('#!/bin/sh') });
  await expect(
    page.getByRole('alert').filter({ hasText: 'does not look like a .png file' }),
  ).toBeVisible();

  // Use it from main.tex and compile.
  await page.getByTestId('file-row').filter({ hasText: 'main.tex' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type('\n\\includegraphics[width=4cm]{gradient.png}');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toContainText('Compiled', { timeout: 90_000 });
  await expect(page.locator('.pdf__page').first()).toBeVisible();

  const zip = await page.request.get(`/api/v1/projects/${projectId}/export.zip`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toBe('application/zip');
  await expect(page.getByTestId('download-zip')).toHaveAttribute(
    'href',
    `/api/v1/projects/${projectId}/export.zip`,
  );
});

/** Minimal stored/deflated ZIP writer (same format as apps/api/test/zip-utils.ts). */
function zipOf(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = deflateRawSync(e.data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x0800, 6);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc32(e.data), 14);
    l.writeUInt32LE(body.length, 18);
    l.writeUInt32LE(e.data.length, 22);
    l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(e.data), 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, name, body);
    centrals.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('import a ZIP from the dashboard, see what was skipped, compile it', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  const zip = zipOf([
    {
      name: 'my-paper/paper.tex',
      data: Buffer.from(
        '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nImported. \\includegraphics[width=3cm]{img/gradient.png}\n\\end{document}\n',
      ),
    },
    { name: 'my-paper/img/gradient.png', data: PNG },
    { name: 'my-paper/paper.aux', data: Buffer.from('\\relax') },
  ]);
  await page
    .getByTestId('import-zip-input')
    .setInputFiles({ name: 'my-paper.zip', mimeType: 'application/zip', buffer: zip });
  const dialog = page.getByRole('dialog', { name: 'Project imported' });
  await expect(dialog).toContainText('main file: paper.tex');
  await expect(page.getByTestId('import-skipped')).toContainText('paper.aux');
  await dialog.getByRole('button', { name: 'Open project' }).click();

  await expect(page.getByTestId('project-name')).toHaveText('my-paper');
  await expect(page.getByTestId('file-row').filter({ hasText: 'paper.tex' })).toContainText('main');
  await page.getByTestId('compile-button').click();
  await expect(page.getByTestId('compile-status')).toContainText('Compiled', { timeout: 90_000 });
});

test('a broken ZIP is explained, not silently ignored', async ({ browser }) => {
  const page = await newSession(browser, 'alice@example.com');
  await page.getByTestId('import-zip-input').setInputFiles({
    name: 'broken.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a zip'),
  });
  await expect(page.getByRole('dialog', { name: 'Import failed' })).toContainText(
    'not a valid ZIP',
  );
});
