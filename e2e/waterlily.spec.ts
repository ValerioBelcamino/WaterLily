import { expect, test } from '@playwright/test';

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

  await page.getByRole('button', { name: /Generate/ }).click();
  const inspector = page.getByLabel('Node inspector');
  await expect(
    inspector.getByText('The end-to-end response is committed.'),
  ).toBeVisible();
  await expect(inspector.getByText('Public reasoning')).toBeVisible();
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
  await expect(
    page.getByText('Persisted branch', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Response to Merged understanding'),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'evidence.txt, attachment' }),
  ).toBeVisible();
  await page
    .getByRole('article', { name: 'Merged understanding, summary' })
    .click();
  await expect(page.getByRole('button', { name: 'Excluded' })).toBeVisible();
});
