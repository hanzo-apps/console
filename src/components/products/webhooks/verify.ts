/**
 * Pure webhook signature-verification reference — the copy-paste verifiers and the
 * live event-subject catalogue the Webhooks product shows on the Security surface.
 * No React / GUI imports, so it is unit-tested in isolation.
 *
 * The signature scheme (matches the delivery headers the platform sends):
 *   X-Webhook-Signature: t=<unix>,v1=hex(hmac_sha256(secret, "<t>.<body>"))
 *   X-Webhook-Event:     the subject that fired (e.g. commerce.order.created)
 *   X-Webhook-Delivery:  a unique id for this delivery attempt
 */

export const SIGNATURE_HEADER = 'X-Webhook-Signature'
export const EVENT_HEADER = 'X-Webhook-Event'
export const DELIVERY_HEADER = 'X-Webhook-Delivery'

/** The human-readable signature payload, shown on the Security card. */
export const SIGNATURE_SCHEME = `${SIGNATURE_HEADER}: t=<unix>,v1=hex(hmac_sha256(secret, "<t>.<body>"))`

/** Node (`node:crypto`) verifier — constant-time, reads the raw request body. */
export function nodeVerifySnippet(): string {
  return `import crypto from 'node:crypto'

// Verify an incoming Hanzo webhook. \`raw\` is the EXACT request body bytes
// (verify BEFORE JSON.parse — a re-serialized body won't match the signature).
export function verifyWebhook(secret, signatureHeader, raw) {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  )
  const signed = \`\${parts.t}.\${raw}\`
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(parts.v1 ?? '')
  // Optionally reject if \`parts.t\` is older than a few minutes (replay defense).
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Express: app.post('/hooks', express.raw({ type: '*/*' }), (req, res) => {
//   const ok = verifyWebhook(process.env.WEBHOOK_SECRET, req.get('${SIGNATURE_HEADER}'), req.body)
//   res.status(ok ? 200 : 400).end()
// })`
}

/** Go (`crypto/hmac`) verifier — constant-time, reads the raw request body. */
export function goVerifySnippet(): string {
  return `package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// VerifyWebhook reports whether an incoming Hanzo webhook is authentic.
// body is the EXACT request body bytes (verify before unmarshaling).
func VerifyWebhook(secret, signatureHeader string, body []byte) bool {
	var t, v1 string
	for _, p := range strings.Split(signatureHeader, ",") {
		if kv := strings.SplitN(p, "=", 2); len(kv) == 2 {
			switch strings.TrimSpace(kv[0]) {
			case "t":
				t = strings.TrimSpace(kv[1])
			case "v1":
				v1 = strings.TrimSpace(kv[1])
			}
		}
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(t + "." + string(body)))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(v1))
}`
}

/** One suggested NATS subject pattern a receiver can subscribe to. */
export type LiveSubject = { pattern: string; label: string }

/**
 * The event subjects the platform emits today, offered as subscribe suggestions.
 * More streams (agents, functions, billing…) land over time — the UI says so
 * honestly rather than implying this is the exhaustive set.
 */
export const LIVE_SUBJECTS: LiveSubject[] = [
  { pattern: 'commerce.order.*', label: 'Order lifecycle — created, paid, fulfilled, refunded' },
  { pattern: 'commerce.checkout.*', label: 'Checkout — started, completed, abandoned' },
  { pattern: 'commerce.>', label: 'Every commerce event (all subjects under commerce)' },
]

export const MORE_STREAMS_NOTE = 'More event streams (agents, functions, billing) are coming.'
