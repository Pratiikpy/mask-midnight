// Configuration refuses to half-start, and says what is missing.

import { describe, it, expect } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

const ok = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  MASK_CONTRACT_ADDRESS: 'a'.repeat(64),
};

describe('loadConfig', () => {
  it('accepts a complete environment', () => {
    const c = loadConfig(ok);
    expect(c.contractAddress).toBe('a'.repeat(64));
    expect(c.appUrl).toBe('http://localhost:5175');
  });

  it('explains how to get a token when there is none', () => {
    // The error a first-time operator will actually see.
    expect(() => loadConfig({ ...ok, TELEGRAM_BOT_TOKEN: undefined })).toThrow(/BotFather/);
  });

  it('catches a token of the wrong shape before the API does', () => {
    expect(() => loadConfig({ ...ok, TELEGRAM_BOT_TOKEN: 'not-a-token' })).toThrow(
      /does not look like a bot token/,
    );
  });

  it('points at the deploy script when the address is missing', () => {
    expect(() => loadConfig({ ...ok, MASK_CONTRACT_ADDRESS: undefined })).toThrow(/deploy\.ts/);
  });

  it('rejects an address that is not 64 hex', () => {
    expect(() => loadConfig({ ...ok, MASK_CONTRACT_ADDRESS: 'abc' })).toThrow(/64 hex/);
  });

  it('throws ConfigError, not a bare Error', () => {
    // The entry point catches this type specifically to print the message
    // without a stack trace.
    try {
      loadConfig({});
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
    }
  });

  it('lowercases the contract address', () => {
    expect(loadConfig({ ...ok, MASK_CONTRACT_ADDRESS: 'A'.repeat(64) }).contractAddress).toBe(
      'a'.repeat(64),
    );
  });

  it('trims a trailing slash off the app URL', () => {
    // Otherwise every link would be built with a double slash.
    expect(loadConfig({ ...ok, MASK_APP_URL: 'https://mask.example/' }).appUrl).toBe(
      'https://mask.example',
    );
  });
});
