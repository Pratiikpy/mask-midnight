// A minimal Telegram Bot API client.
//
// Written against fetch rather than pulling in a bot framework. The surface
// actually used here is four methods, and a dependency that ships its own HTTP
// stack, its own event emitter and its own polling loop is a poor trade for
// that — particularly in a repository where the point is that a reader can see
// exactly what leaves the machine.
//
// Long polling, not webhooks: a webhook needs a public HTTPS endpoint, which a
// local devnet does not have. `getUpdates` works from anywhere, including from
// behind a laptop's NAT, and the two are interchangeable later.

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
  from?: { id: number; is_bot: boolean; username?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface InlineButton {
  text: string;
  url: string;
}

export class TelegramError extends Error {
  readonly code: number;
  constructor(method: string, code: number, description: string) {
    super(`${method} failed (${code}): ${description}`);
    this.name = 'TelegramError';
    this.code = code;
  }
}

export class TelegramClient {
  readonly #base: string;
  readonly #fetch: typeof fetch;

  /** Requests made, so a silent bot can be told apart from a stuck one. */
  readonly stats = { calls: 0, errors: 0 };

  constructor(token: string, fetchImpl: typeof fetch = fetch) {
    if (!token) throw new Error('A bot token is required.');
    this.#base = `https://api.telegram.org/bot${token}`;
    this.#fetch = fetchImpl;
  }

  async #call<T>(method: string, body: Record<string, unknown>, timeoutMs = 70_000): Promise<T> {
    this.stats.calls++;
    // Long polling holds the connection open on purpose, so the timeout has to
    // exceed the poll window or every request would look like a failure.
    const abort = AbortSignal.timeout(timeoutMs);
    const res = await this.#fetch(`${this.#base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort,
    });

    const payload = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };

    if (!payload.ok) {
      this.stats.errors++;
      throw new TelegramError(method, payload.error_code ?? res.status, payload.description ?? 'unknown');
    }
    return payload.result as T;
  }

  /** Block until an update arrives or the window closes. */
  getUpdates(offset: number, timeoutSeconds = 50): Promise<TelegramUpdate[]> {
    return this.#call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: ['message'] },
      (timeoutSeconds + 15) * 1000,
    );
  }

  sendMessage(chatId: number, text: string, buttons?: InlineButton[]): Promise<TelegramMessage> {
    return this.#call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      // No preview: every link here points at the app, and a unfurled preview
      // of a payment link would render its contents into the chat.
      link_preview_options: { is_disabled: true },
      ...(buttons && buttons.length > 0
        ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))] } }
        : {}),
    }, 20_000);
  }

  setMyCommands(commands: readonly { command: string; description: string }[]): Promise<boolean> {
    return this.#call<boolean>('setMyCommands', { commands }, 20_000);
  }

  getMe(): Promise<{ id: number; username: string }> {
    return this.#call<{ id: number; username: string }>('getMe', {}, 20_000);
  }
}
