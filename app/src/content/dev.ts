// Developer-facing content shared by the Developer and Docs pages.

export interface Snippet {
  title: string;
  lang: string;
  code: string;
}

export const SNIPPETS: Snippet[] = [
  {
    title: 'Node — create an invoice',
    lang: 'ts',
    code: `import { Mask } from '@mask/node';

const mask = new Mask({
  contractAddress: process.env.MASK_CONTRACT_ADDRESS!,
  indexerUri: 'http://localhost:8088/api/v4/graphql',
  indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
  merchantKey: process.env.MASK_MERCHANT_KEY!,
  appUrl: 'https://pay.yourshop.com',
});

const invoice = mask.createInvoice({ amount: 42_500n });
// Send invoice.paymentLink to the payer. The terms ride in the URL
// fragment, which browsers never transmit to a server.`,
  },
  {
    title: 'Node — confirm a payment',
    lang: 'ts',
    code: `// Reads public chain state. No wallet, no proving, no trust in us.
const settled = await mask.isSettled(commitment);
const real = await mask.receiptExists(receipt);

// Neither call returns an amount, because the chain holds none.`,
  },
  {
    title: 'Python',
    lang: 'py',
    code: `from mask_midnight import Mask

mask = Mask(
    contract_address=os.environ["MASK_CONTRACT_ADDRESS"],
    merchant_key=os.environ["MASK_MERCHANT_KEY"],
    app_url="https://pay.yourshop.com",
    webhook_secret=os.environ["MASK_WEBHOOK_SECRET"],
)

invoice = mask.create_invoice(42_500)
print(invoice.payment_link)`,
  },
  {
    title: 'Webhooks',
    lang: 'ts',
    code: `app.post('/mask-webhook', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.header('X-Mask-Signature') ?? '';
  if (!mask.verifyWebhook(req.body.toString('utf8'), signature)) {
    return res.sendStatus(401);
  }

  const event = JSON.parse(req.body.toString('utf8'));
  // event.type            'checkout.settled'
  // event.clientReference your order id
  // There is no event.amount. The backend never sees one.
  fulfil(event.clientReference);
  res.sendStatus(200);
});`,
  },
  {
    title: 'CLI',
    lang: 'bash',
    code: `export MASK_MERCHANT_KEY=$(mask keygen)
export MASK_CONTRACT_ADDRESS=...

mask invoice 42500 --kind multipay --token musdc
mask status <commitment>
mask receipt <digest>`,
  },
  {
    title: 'MCP — for AI clients',
    lang: 'json',
    code: `{
  "mcpServers": {
    "mask": {
      "command": "mask-mcp",
      "env": {
        "MASK_CONTRACT_ADDRESS": "...",
        "MASK_MERCHANT_KEY": "..."
      }
    }
  }
}`,
  },
];

export const CIRCUITS: [string, string][] = [
  ['create_invoice', 'Publish a commitment. ~25s'],
  ['settle_invoice', 'Record a payment: a receipt and a nullifier, no coin moves. ~24-30s'],
  ['settle_invoice_shielded', 'Pay and move a shielded coin of the right asset. ~36-59s'],
  ['settle_invoice_converted', 'Pay in a different asset; the rate is proven by oracle signature'],
  ['settle_batch', 'Four invoices under one proof — the /batch page. ~60s, against ~100s one at a time'],
  ['close_invoice / cancel_invoice', 'Owner only: needs the per-invoice owner secret, which is never in a payment link. Cancel is refused once anyone has paid'],
  ['refund_payment', 'Owner only. Returns a shielded coin of the paid amount to the payer in the same transaction; each payment can be refunded once. ~45s'],
  ['attest_revenue_at_least', 'Prove revenue over 4 payments passed a threshold. ~53s'],
];
