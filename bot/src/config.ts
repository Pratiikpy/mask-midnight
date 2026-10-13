// Configuration, and refusing to start half-configured.
//
// A bot that boots without a chain and answers every lookup with an error is
// worse than one that does not boot: it looks alive. So the checks happen once,
// at startup, and say exactly which value is missing and where to get it.

export interface BotConfig {
  token: string;
  contractAddress: string;
  indexerUri: string;
  indexerWsUri: string;
  appUrl: string;
  pollSeconds: number;
  notifyIntervalMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Read configuration from the environment.
 *
 * `env` is a parameter so tests do not have to mutate `process.env`, which is
 * global state shared with every other test in the run.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): BotConfig {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new ConfigError(
      'TELEGRAM_BOT_TOKEN is not set.\n' +
        'Create a bot with @BotFather in Telegram; it replies with a token that\n' +
        'looks like 123456789:AA... Put it in the environment and start again.',
    );
  }
  // A token is `<digits>:<secret>`. Catching the shape here turns a confusing
  // 404 from the API into a sentence.
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new ConfigError(
      'TELEGRAM_BOT_TOKEN does not look like a bot token. It should be digits, a\n' +
        'colon, then a long secret — exactly as @BotFather sent it.',
    );
  }

  const contractAddress = env.MASK_CONTRACT_ADDRESS?.trim();
  if (!contractAddress) {
    throw new ConfigError(
      'MASK_CONTRACT_ADDRESS is not set. Deploy with devkit/src/deploy.ts, which\n' +
        'writes the address to app/.env.local, and pass the same value here.',
    );
  }
  if (!HEX64.test(contractAddress)) {
    throw new ConfigError('MASK_CONTRACT_ADDRESS must be 64 hex characters.');
  }

  const appUrl = (env.MASK_APP_URL ?? 'http://localhost:5175').replace(/\/+$/, '');

  return {
    token,
    contractAddress: contractAddress.toLowerCase(),
    indexerUri: env.MASK_INDEXER_URI ?? 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUri: env.MASK_INDEXER_WS_URI ?? 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    appUrl,
    pollSeconds: Number(env.MASK_BOT_POLL_SECONDS ?? 50),
    notifyIntervalMs: Number(env.MASK_BOT_NOTIFY_MS ?? 15_000),
  };
}
