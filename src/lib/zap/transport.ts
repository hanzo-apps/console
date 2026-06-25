/**
 * Generic ZAP RPC envelope for console2 — the wire-level request/reply structs.
 *
 * This mirrors the proven envelope shipped in `hanzoai/sign`
 * (`packages/trpc/zap/gen/transport_zap.ts`, codegen'd by `zapgen --target=ts`):
 * a single generic `ZapRequest{ method, payload }` / `ZapReply{ ok, status,
 * result, errorJson }` pair, dispatched through ONE method ordinal. `payload`
 * and `result` are SuperJSON strings, so any `/v1` resource call rides this
 * envelope without per-endpoint Cap'n-Proto-style codegen — the backend routes
 * on the `method` string (e.g. `"get-global-providers"`).
 *
 * Hand-written here (not generated) on purpose: console2's backend is the Go
 * casibase service (`hanzoai/cloud`), whose ZAP surface is a generic
 * method-string router, not a `.zap`-schema service. When the backend ships a
 * canonical `console.zap` schema we regenerate this file with `zapgen` and drop
 * the hand-written version — the call surface in `client.ts` stays identical.
 *
 * Wire is binary ZAP (zero-copy, byte-compatible with `github.com/luxfi/zap`).
 * NOT JSON-over-HTTP, NOT tRPC, NOT gRPC.
 */
import { Builder, Message, StructView } from '@zap-proto/zap'

const zapRequestOff = { Method: 0, Payload: 8 } as const
const zapRequestSize = 16

/** Zero-copy view into a ZAP-encoded ZapRequest. */
export class ZapRequest extends StructView {
  static wrap(b: Uint8Array): ZapRequest {
    const root = Message.parse(b).root()
    return new ZapRequest(root.data, root.offset)
  }
  get method(): string {
    return this.text(zapRequestOff.Method)
  }
  get payload(): string {
    return this.text(zapRequestOff.Payload)
  }
}

export interface ZapRequestInput {
  /** Route name the backend dispatches on (a `/v1` endpoint, sans prefix). */
  method: string
  /** SuperJSON-encoded arguments ('' for none). */
  payload: string
}

/** Build a ZAP-encoded ZapRequest and return the bytes. */
export function newZapRequest(in_: ZapRequestInput): Uint8Array {
  const b = new Builder(256)
  const ob = b.startObject(zapRequestSize)
  ob.setText(zapRequestOff.Method, in_.method)
  ob.setText(zapRequestOff.Payload, in_.payload)
  ob.finishAsRoot()
  return b.finish()
}

const zapReplyOff = { Ok: 0, Status: 4, Result: 8, ErrorJson: 16 } as const

/** Zero-copy view into a ZAP-encoded ZapReply. */
export class ZapReply extends StructView {
  static wrap(b: Uint8Array): ZapReply {
    const root = Message.parse(b).root()
    return new ZapReply(root.data, root.offset)
  }
  get ok(): boolean {
    return this.bool(zapReplyOff.Ok)
  }
  get status(): number {
    return this.u32(zapReplyOff.Status)
  }
  /** SuperJSON-encoded result ('' for void). */
  get result(): string {
    return this.text(zapReplyOff.Result)
  }
  /** JSON error envelope on `ok === false`. */
  get errorJson(): string {
    return this.text(zapReplyOff.ErrorJson)
  }
}

/**
 * The single method ordinal every console2 RPC ships on. The backend's root
 * capability decodes the `ZapRequest`, routes on `method`, and replies with a
 * `ZapReply`. (Matches sign's `METHOD_RPC`.)
 */
export const METHOD_RPC = 1
