// The bot process.
//
// Long-polls Telegram, routes each message through the pure handler in
// commands.ts, and runs the settlement notifier alongside. Everything with
// logic lives elsewhere and is unit-tested; this file is wiring, so that the
// part which cannot be tested without a token is the part with nothing in it.

import { loadConfig, ConfigError } from './config.ts';
import { LiveChain } from './chain.ts';
import { TelegramClient, type TelegramUpdate } from './telegram.ts';
import { COMMANDS, handle, type BotContext } from './commands.ts';
import { MemoryWatchStore, SettlementNotifier } from './watch.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`\n${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  const telegram = new TelegramClient(config.token);
  const chain = new LiveChain(config);
  const watches = new MemoryWatchStore();

  const me = await telegram.getMe();
  console.log(`connected as @${me.username}`);
  console.log(`contract ${config.contractAddress}`);
  console.log(`app      ${config.appUrl}`);

  await telegram.setMyCommands(COMMANDS);

  const notifier = new SettlementNotifier(watches, chain, {
    intervalMs: config.notifyIntervalMs,
    send: async (chatId, text) => {
      await telegram.sendMessage(chatId, text);
    },
  });
  notifier.start();

  const ctx: BotContext = {
    chain,
    appUrl: config.appUrl,
    watched: (chatId) => watches.list(chatId),
    watch: (chatId, commitment) => watches.add(chatId, commitment),
    unwatch: (chatId, commitment) => watches.remove(chatId, commitment),
  };

  let offset = 0;
  let running = true;
  const stop = () => {
    running = false;
    notifier.stop();
    console.log('\nstopping');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log('listening');

  while (running) {
    let updates: TelegramUpdate[];
    try {
      updates = await telegram.getUpdates(offset, config.pollSeconds);
    } catch (e) {
      // A dropped long poll is normal — the connection is held open for a
      // minute at a time. Back off briefly rather than hammering the API.
      console.error(`poll failed: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const message = update.message ?? update.edited_message;
      const text = message?.text;
      if (!message || !text) continue;

      try {
        const reply = await handle(text, message.chat.id, ctx);
        await telegram.sendMessage(message.chat.id, reply.text, reply.buttons);
      } catch (e) {
        // One bad message must not end the process. The user is told something
        // went wrong rather than being left with silence.
        console.error(`handling failed: ${e instanceof Error ? e.message : String(e)}`);
        await telegram
          .sendMessage(
            message.chat.id,
            'Something went wrong reading the chain. Try again in a moment.',
          )
          .catch(() => undefined);
      }
    }
  }
}

main().catch((e) => {
  console.error('bot failed:', e);
  process.exitCode = 1;
});
