// The full payment story, as a stranger would run it, in demo mode.
//
// Demo mode runs the real compiled contract in the browser, so the refusals
// asserted here are the contract's own messages, not the UI's. Console, page
// error and failed-request listeners are attached to every context and the
// suite fails if any fire: zero console errors is part of every page's pass
// criteria.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

function watch(page: Page, problems: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) =>
    problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`),
  );
}

async function startDemo(page: Page) {
  await page.goto('/create');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByRole('status')).toContainText('Demo mode');
}

async function createInvoice(page: Page, amount: string): Promise<string> {
  await page.getByPlaceholder('42500').fill(amount);
  await page.getByRole('button', { name: /^Create invoice/ }).click();
  await expect(page.getByText('Accepted by the contract')).toBeVisible();
  const link = page.locator('text=/^http.*\\/pay#/').first();
  await expect(link).toBeVisible();
  return (await link.textContent())!.trim();
}

async function goTo(page: Page, name: string) {
  // On a phone the links sit behind the menu button; on a desktop they are in the bar.
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name, exact: true }).click();
    return;
  }
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
}

async function loadLink(page: Page, link: string) {
  await page.getByPlaceholder('https://…/pay#…').fill(link);
  await page.getByRole('button', { name: 'Load invoice' }).click();
}

test.describe('demo mode, one party', () => {
  test('create, pay, replay refused, ledger shows no amount', async ({ page }) => {
    const problems: string[] = [];
    watch(page, problems);
    await startDemo(page);

    const link = await createInvoice(page, '42500');
    await goTo(page, 'Pay');
    await loadLink(page, link);
    await expect(page.getByText('42,500').first()).toBeVisible();

    await page.getByRole('button', { name: /^Pay 42,500/ }).click();
    await expect(page.getByText(/Keep this. It proves the payment happened/)).toBeVisible();

    // The same payment again is refused by the contract, with its own message.
    await page.getByRole('button', { name: /^Pay 42,500/ }).click();
    await expect(page.getByText('invoice is not open').first()).toBeVisible();

    // The explorer reads the ledger and must not contain the amount anywhere.
    await goTo(page, 'Explorer');
    await expect(page).toHaveURL(/\/explorer$/);
    await expect(page.getByText(/Nothing was submitted/)).toHaveCount(0);
    const body = await page.locator('main').innerText();
    expect(body).not.toContain('42500');
    expect(body).not.toContain('42,500');

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('record-only payment closes the invoice without moving a coin', async ({ page }) => {
    const problems: string[] = [];
    watch(page, problems);
    await startDemo(page);

    const link = await createInvoice(page, '900');
    await goTo(page, 'Pay');
    await loadLink(page, link);
    await page.getByText('Record the payment only').click();
    await page.getByRole('button', { name: /^(Record|Pay)/ }).last().click();
    await expect(page.getByText(/Keep this. It proves the payment happened/)).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the merchant cancels an unpaid invoice, then paying it is refused', async ({ page }) => {
    const problems: string[] = [];
    watch(page, problems);
    await startDemo(page);

    const link = await createInvoice(page, '1200');
    await goTo(page, 'Dashboard');
    await page.getByRole('button', { name: 'Cancel invoice' }).click();
    await expect(page.getByText('Accepted by the contract')).toBeVisible();
    await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible();

    await goTo(page, 'Pay');
    await loadLink(page, link);
    await page.getByRole('button', { name: /^Pay 1,200/ }).click();
    await expect(page.getByText('invoice is not open').first()).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the payer asks for a refund, the merchant refunds once, a second refund is refused', async ({
    page,
  }) => {
    const problems: string[] = [];
    watch(page, problems);
    await startDemo(page);

    const link = await createInvoice(page, '3300');
    await goTo(page, 'Pay');
    await loadLink(page, link);
    await page.getByRole('button', { name: /^Pay 3,300/ }).click();
    await expect(page.getByText(/Keep this\. It proves the payment happened/)).toBeVisible();

    // The refund code is shown on the payer's receipt and carries no amount.
    const codeNode = page.locator('p.font-mono', { hasText: /^ey/ }).last();
    await expect(codeNode).toBeVisible();
    const code = (await codeNode.textContent())!.trim();
    expect(code).not.toContain('3300');

    await goTo(page, 'Dashboard');
    await page.getByRole('button', { name: 'Refund a payment' }).click();
    await page.getByPlaceholder("Paste the payer's refund code").fill(code);
    await page.getByRole('button', { name: /^Refund 3,300/ }).click();
    await expect(page.getByText('Accepted by the contract')).toBeVisible();

    // The same payment cannot be refunded twice, and the contract says so.
    await page.getByPlaceholder("Paste the payer's refund code").fill(code);
    await page.getByRole('button', { name: /^Refund 3,300/ }).click();
    await expect(page.getByText('payment already refunded').first()).toBeVisible();

    // A garbled code is refused before anything is sent.
    await page.getByPlaceholder("Paste the payer's refund code").fill('nonsense');
    await page.getByRole('button', { name: /^Refund 3,300/ }).click();
    await expect(page.getByText(/not a refund code/)).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('no payment link carries the owner secret, the title or the memo', async ({ page, context }) => {
    const problems: string[] = [];
    watch(page, problems);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await startDemo(page);

    await page.getByPlaceholder('42500').fill('500');
    await page.getByPlaceholder('Design retainer, March').fill('TITLE-PRIVATE-7731');
    await page.getByPlaceholder('Optional').fill('MEMO-PRIVATE-9142');
    await page.getByRole('button', { name: /^Create invoice/ }).click();
    await expect(page.getByText('Accepted by the contract')).toBeVisible();
    const shown = (await page.locator('text=/^http.*\\/pay#/').first().textContent())!.trim();

    // The link shown after creating, and the one copied later from the dashboard.
    await goTo(page, 'Dashboard');
    await page.getByRole('button', { name: 'Copy payment link' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    const vault = await page.evaluate(() => {
      const raw = localStorage.getItem('mask.invoices.v1');
      return raw ? (JSON.parse(raw) as { ownerSecret?: string }[])[0]!.ownerSecret! : '';
    });
    expect(vault).toMatch(/^[0-9a-f]{64}$/);

    for (const link of [shown, copied]) {
      const fragment = link.split('#')[1]!;
      const decoded = Buffer.from(fragment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const payload = JSON.parse(decoded) as Record<string, unknown>;
      expect(Object.keys(payload)).not.toContain('ownerSecret');
      expect(Object.keys(payload)).not.toContain('title');
      expect(Object.keys(payload)).not.toContain('memo');
      expect(decoded).not.toContain(vault);
      expect(decoded).not.toContain('TITLE-PRIVATE-7731');
      expect(decoded).not.toContain('MEMO-PRIVATE-9142');
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('junk payment link is refused with a message, not a crash', async ({ page }) => {
    const problems: string[] = [];
    watch(page, problems);
    await startDemo(page);
    await goTo(page, 'Pay');
    await loadLink(page, 'not a link');
    await expect(page.getByText(/Could not read that link/)).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('a one-hour expiry is written in seconds', async ({ page }) => {
    const problems: string[] = [];
    watch(page, problems);
    await startDemo(page);
    await page.getByPlaceholder('42500').fill('100');
    await page.getByRole('button', { name: '1 hour', exact: true }).click();
    await page.getByRole('button', { name: /^Create invoice/ }).click();
    await expect(page.getByText('Accepted by the contract')).toBeVisible();
    const stored = await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        try {
          const v = JSON.parse(localStorage.getItem(k)!);
          const list = Array.isArray(v) ? v : [];
          const hit = list.find((i: { expiresAt?: string }) => i.expiresAt && i.expiresAt !== '0');
          if (hit) return hit.expiresAt as string;
        } catch {
          /* not json */
        }
      }
      return null;
    });
    expect(stored).not.toBeNull();
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Seconds since the epoch, roughly an hour ahead; never milliseconds.
    expect(Number(stored)).toBeGreaterThan(nowSeconds);
    expect(Number(stored)).toBeLessThan(nowSeconds + 3_700);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test.describe('two parties, two isolated contexts', () => {
  test('a payer in a separate browser context cannot see the merchant vault', async ({
    browser,
  }) => {
    const merchantCtx: BrowserContext = await browser.newContext();
    const payerCtx: BrowserContext = await browser.newContext();
    const merchant = await merchantCtx.newPage();
    const payer = await payerCtx.newPage();
    const problems: string[] = [];
    watch(merchant, problems);
    watch(payer, problems);

    await startDemo(merchant);
    await createInvoice(merchant, '777');

    await payer.goto('/dashboard');
    await expect(payer.getByText('777')).toHaveCount(0);

    expect(problems, problems.join('\n')).toEqual([]);
    await merchantCtx.close();
    await payerCtx.close();
  });
});

test.describe('every page loads clean', () => {
  const routes = [
    '/',
    '/vision',
    '/privacy',
    '/docs',
    '/support',
    '/settings',
    '/create',
    '/dashboard',
    '/pay',
    '/batch',
    '/giftcards',
    '/cards',
    '/attest',
    '/explorer',
    '/verify',
    '/developer',
    '/telegram-bot',
  ];
  for (const route of routes) {
    test(`${route}: renders with no console errors and no horizontal scroll`, async ({ page }) => {
      const problems: string[] = [];
      watch(page, problems);
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
