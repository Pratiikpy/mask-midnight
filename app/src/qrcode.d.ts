// Minimal types for `qrcode`.
//
// The package ships no types and @types/qrcode is a separate install; only one
// function is used here, so declaring it is smaller and more honest than
// pulling in a whole definition package for a single call.
declare module 'qrcode' {
  interface ToDataURLOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }
  export function toDataURL(text: string, options?: ToDataURLOptions): Promise<string>;
  const _default: { toDataURL: typeof toDataURL };
  export default _default;
}
