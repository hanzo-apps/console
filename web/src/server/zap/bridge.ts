/**
 * ZAP transport bridge.
 *
 * The RPC machinery (`Conn`, `Server`, `Pipeline`, `Registry`) lives in zap-es;
 * this module only supplies the wire shuttle. We mirror zap-es's own proven
 * two-party transport (test/integration/rpc.utils.ts): a {@link DeferredTransport}
 * driven by a `node:worker_threads` MessageChannel. MessageChannel gives correct
 * async buffering + ordering for free — a message sent before the peer parks its
 * next recv is queued by the channel, not dropped. Both the HTTP route's server
 * side and the in-process test run entirely in Node, so this is the one way.
 *
 * RPCMessage <-> bytes: an outbound RPC `Message` struct is re-rooted into a fresh
 * Message and serialized with `toArrayBuffer()` (the canonical encoding);
 * DeferredTransport.resolve re-parses the bytes into a fresh RPCMessage on recv.
 */
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { Conn, DeferredTransport, Message } from "zap-es";

// The RPC `Message` type that DeferredTransport.sendMessage expects is the
// capnp/rpc Message, which zap-es does not export by name (its public `Message`
// is the serialization Message). Recover the exact expected type from the base
// method's signature so our override matches and the subclass stays a Transport.
type RPCMessage = Parameters<DeferredTransport["sendMessage"]>[0];

// zap-es's InterfaceCtor / ServerTarget are not exported by name either; recover
// the constraint Conn.initMain enforces so callers can pass a generated interface
// (e.g. ZapRoot) directly with full type-checking.
type AnyInterfaceCtor = Parameters<Conn["initMain"]>[0];
type ClientOf<S> = S extends { Client: new (client: never) => infer C }
  ? C
  : never;
type TargetOf<S> = Parameters<Conn["initMain"]>[1];

/** DeferredTransport over a MessageChannel port (mirrors zap-es rpc.utils). */
class MessagePortTransport extends DeferredTransport {
  constructor(private readonly port: MessagePort) {
    super();
    this.port.on("message", this.resolve);
    this.port.on("messageerror", this.reject);
    this.port.on("close", this.onClose);
  }

  private onClose = (): void => {
    this.port.off("message", this.resolve);
    this.port.off("messageerror", this.reject);
    this.port.off("close", this.onClose);
    this.port.close();
    super.close();
  };

  sendMessage(msg: RPCMessage): void {
    const m = new Message();
    // Re-root the RPC message into a fresh Message so we serialize exactly the
    // canonical wire bytes (not the source message's incidental segment state).
    m.setRoot(msg as unknown as Parameters<Message["setRoot"]>[0]);
    const buf = m.toArrayBuffer();
    this.port.postMessage(buf, [buf]);
  }
}

/**
 * Bootstrap an RPC session: the `initMain` side exports `RootInterface` backed by
 * `target`; the returned `bootstrap()` yields a typed client. Both Conns ride a
 * single MessageChannel (port1 <-> port2).
 *
 * `RootInterface` is a zap-es interface ctor (`.Client` / `.Server`), e.g. the
 * generated `ZapRoot`. `target` implements its `$Server$Target`.
 */
export function connectInProcess<S extends AnyInterfaceCtor>(
  RootInterface: S,
  target: TargetOf<S>,
): { clientConn: Conn; serverConn: Conn; bootstrap(): ClientOf<S> } {
  const channel = new MessageChannel();
  const serverConn = new Conn(new MessagePortTransport(channel.port1));
  // The work loop rethrows on transport close (expected at shutdown) and after a
  // method impl rejects (the rejection is already delivered to the client as a
  // return-exception). Absorb both so they don't surface as unhandled.
  serverConn.onError = () => {};
  serverConn.initMain(RootInterface, target);
  const clientConn = new Conn(new MessagePortTransport(channel.port2));
  clientConn.onError = () => {};
  return {
    clientConn,
    serverConn,
    bootstrap: () => clientConn.bootstrap(RootInterface) as ClientOf<S>,
  };
}

export { MessagePortTransport };
