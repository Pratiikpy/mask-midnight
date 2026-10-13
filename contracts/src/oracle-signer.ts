// Mask's conversion oracle — a real Schnorr signer over Jubjub.
//
// Lives beside the contracts because both the test suite and the devkit need
// it, and it must stay in lockstep with vendor/schnorr.compact.
//
// The contract verifies these signatures inside the circuit, so the signing
// side has to match the verifier exactly: same challenge construction, same
// 248-bit truncation, same field arithmetic. Anything approximate here simply
// fails to verify, which is the correct outcome — a "mock oracle" that the
// contract accepts would mean the contract is not checking anything.
//
// Verifier: contracts/src/vendor/schnorr.compact
//   c_full = transientHash(SchnorrHashInput{ann_x, ann_y, pk_x, pk_y, msg})
//   c      = c_full mod 2^248
//   check  : G*s == R + pk*c

import { webcrypto } from 'node:crypto';
import {
  CompactTypeField,
  CompactTypeVector,
  ecMulGenerator,
  transientHash,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';

/** Order of the Jubjub prime-order subgroup. */
export const JUBJUB_ORDER =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

/** 2^248 — the truncation modulus the verifier uses for the challenge. */
export const TWO_248 = 1n << 248n;

export interface SchnorrSignature {
  announcement: JubjubPoint;
  response: bigint;
}

export interface OracleKeypair {
  secret: bigint;
  publicKey: JubjubPoint;
}

/** The struct the verifier hashes: four scalars, then a 4-element message. */
const challengeType = new CompactTypeVector(8, CompactTypeField);

const randomScalar = (): bigint => {
  // Rejection-sample so the scalar is uniform over [1, order).
  for (;;) {
    const bytes = webcrypto.getRandomValues(new Uint8Array(32));
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    v %= JUBJUB_ORDER;
    if (v !== 0n) return v;
  }
};

export const generateOracleKeypair = (): OracleKeypair => {
  const secret = randomScalar();
  return { secret, publicKey: ecMulGenerator(secret) };
};

/**
 * Reproduce the verifier's challenge exactly.
 *
 * The Compact side hashes a struct whose fields are laid out as
 * (ann_x, ann_y, pk_x, pk_y, msg[0..3]) — eight field elements in order.
 */
export const challenge = (
  announcement: JubjubPoint,
  publicKey: JubjubPoint,
  msg: bigint[],
): bigint => {
  if (msg.length !== 4) throw new Error(`quote digest must be 4 fields, got ${msg.length}`);
  const full = transientHash(challengeType, [
    announcement.x,
    announcement.y,
    publicKey.x,
    publicKey.y,
    ...msg,
  ]);
  return full % TWO_248;
};

/** Sign a 4-field quote digest. */
export const sign = (kp: OracleKeypair, msg: bigint[]): SchnorrSignature => {
  const r = randomScalar();
  const announcement = ecMulGenerator(r);
  const c = challenge(announcement, kp.publicKey, msg);
  const response = (r + ((c % JUBJUB_ORDER) * kp.secret)) % JUBJUB_ORDER;
  return { announcement, response };
};
