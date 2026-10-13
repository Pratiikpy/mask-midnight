// Wraps the compiler output in the CompiledContract value midnight-js expects.
//
// On the 4.1.1 line you cannot hand `deployContract` a raw `new Contract(...)`.
// It wants a CompiledContract built with `make(tag, ctor)` and then piped
// through `withWitnesses` and `withCompiledFileAssets`; passing the raw class
// fails deep inside compact-js with "Cannot read properties of undefined
// (reading 'ctor')".

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import * as MaskSmoke from '../../contracts/build/mask_smoke/contract/index.js';
import { witnesses, type MaskPrivateState } from './witnesses.ts';

/**
 * Directory holding the compiler's output for mask_smoke — `keys/`, `zkir/`
 * and `compiler/`. Used as the base path for the zk config provider.
 */
export const MASK_SMOKE_ASSETS = new URL('../../contracts/build/mask_smoke', import.meta.url).pathname;

export const MaskSmokeContract = CompiledContract.make<
  MaskSmoke.Contract<MaskPrivateState>
>('MaskSmoke', MaskSmoke.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  // Relative paths resolve against the base path given to each service that
  // reads compiled assets, which is MASK_SMOKE_ASSETS.
  CompiledContract.withCompiledFileAssets('.'),
);

export type { MaskSmoke };
