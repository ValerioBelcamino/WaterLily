import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('generates from a graph head and persists graph and view changes', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Oxidative phosphorylation' }),
  ).toBeVisible();
  await expect(page.getByText('online', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Model provider')).toHaveValue(
    'local-openai-compatible',
  );
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 7 nodes/,
    }),
  ).toBeVisible();

  const canvas = page.getByRole('region', {
    name: 'Conversation graph canvas',
  });
  await canvas.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        ['External evidence: proton flow powers ATP synthase.'],
        'evidence.txt',
        { lastModified: 42, type: 'text/plain' },
      ),
    );
    element.dispatchEvent(
      new DragEvent('dragenter', {
        bubbles: true,
        clientX: 220,
        clientY: 180,
        dataTransfer: transfer,
      }),
    );
    element.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        clientX: 220,
        clientY: 180,
        dataTransfer: transfer,
      }),
    );
  });
  await expect(
    page.getByText('Connected 1 file to Merged understanding.'),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'evidence.txt, attachment' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 8 nodes/,
    }),
  ).toBeVisible();

  const synthesisNode = page.getByRole('article', {
    name: /^Merged understanding, summary/,
  });
  const evidenceNode = page.getByRole('article', {
    name: /evidence\.txt/,
  });
  const noteNode = page.getByRole('article', { name: /Dam analogy/ });
  await expect(evidenceNode).toContainText('unsupported file');
  await page.getByRole('button', { name: /Generate/ }).click();
  await expect(page.getByRole('alert')).toContainText(
    'cannot receive evidence.txt',
  );

  await evidenceNode.click();
  await page.getByRole('button', { name: 'Included' }).click();
  await expect(page.getByRole('button', { name: 'Excluded' })).toBeVisible();
  await synthesisNode.click();
  await page.getByRole('button', { name: /Generate/ }).click();
  await expect(synthesisNode).toHaveClass(/is-flow-running/u);
  await expect(synthesisNode).toHaveCSS(
    'animation-name',
    'active-context-node-pulse',
  );
  await expect(evidenceNode).toHaveAttribute('data-flow-state', 'inactive');
  await expect(noteNode).toHaveAttribute('data-flow-state', 'inactive');
  await expect(noteNode).toHaveCSS('opacity', '0.32');
  await expect(page.locator('.context-flow-edge--active')).not.toHaveCount(0);
  const inspector = page.getByLabel('Node inspector');
  await expect(
    inspector.getByText('The end-to-end response is committed.'),
  ).toBeVisible();
  await expect(inspector.getByText('Public reasoning')).toBeVisible();
  await expect(page.locator('.context-flow-edge--running')).toHaveCount(0);
  await expect(
    page.getByText('The graph changed while the response was being committed'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 9 nodes/,
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Included' }).click();
  await expect(page.getByRole('button', { name: 'Excluded' })).toBeVisible();

  await page.getByRole('button', { name: /Branch/ }).click();
  await page.getByLabel('Title').fill('Persisted branch');
  await page.getByLabel('Message').fill('Test a durable side question.');
  await page.getByRole('button', { name: 'Branch from node' }).click();
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 10 nodes/,
    }),
  ).toBeVisible();

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByText('online', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 10 nodes/,
    }),
  ).toBeVisible();
  await expect(page.getByText('Persisted branch', { exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByText('Response to Merged understanding')).toHaveCount(
    1,
  );
  await expect(page.locator('.conversation-node--attachment')).toHaveCount(1);
  await expect(
    page.getByLabel('Node inspector').getByText('Merged understanding'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluded' })).toBeVisible();

  await page.getByRole('button', { name: /Checkpoint/ }).click();
  await page.getByLabel('Node title').fill('Durable exam checkpoint');
  await page
    .getByLabel('Persistent summary')
    .fill('Compact understanding: {{mechanism}}');
  await page.getByRole('button', { name: 'Create summary checkpoint' }).click();
  await expect(page.getByText('context root')).toBeVisible();
  await page.getByLabel('Source for mechanism').selectOption('node-answer');
  await expect(page.locator('.template-binding-edge')).toHaveCount(1);
  await expect(page.locator('.template-binding-edge')).toHaveClass(
    /context-flow-edge--active/u,
  );
  await expect(
    page.getByRole('article', { name: /^Mechanism overview, assistant/ }),
  ).toHaveAttribute('data-flow-state', 'active');
  await page.getByRole('button', { name: 'Edit node content' }).click();
  await page
    .getByLabel('Editable content')
    .fill('Edited compact understanding: {{mechanism}}');
  await page.getByRole('button', { name: /Save revision/ }).click();
  await expect(page.getByLabel('Source for mechanism')).toHaveValue(
    'node-answer',
  );
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 11 nodes/,
    }),
  ).toBeVisible();

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByText('online', { exact: true })).toBeVisible();
  await page
    .getByRole('article', { name: /^Durable exam checkpoint, summary/ })
    .click();
  await expect(page.getByLabel('Source for mechanism')).toHaveValue(
    'node-answer',
  );
  await expect(
    page
      .getByLabel('Node inspector')
      .getByText('Edited compact understanding: {{mechanism}}'),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('graph-bioenergetics.waterlily');
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();

  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    buffer: await readFile(archivePath),
    mimeType: 'application/vnd.waterlily+zip',
    name: download.suggestedFilename(),
  });
  await expect(page.getByText(/Ready to import .*\.waterlily/u)).toBeVisible();
  await page.getByRole('button', { name: 'Validate & import' }).click();
  await expect(
    page.getByText('Imported 11 nodes and 1 attachment.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Oxidative phosphorylation 22 nodes/,
    }),
  ).toBeVisible();
  // Wait for React Flow's controlled projection to reconcile all imported
  // nodes; the sidebar count updates one render earlier on slower machines.
  await expect(page.locator('.react-flow__node-conversation')).toHaveCount(22);
  await expect(page.locator('.conversation-node--attachment')).toHaveCount(2);
  await expect(page.locator('.template-binding-edge')).toHaveCount(2);
});
