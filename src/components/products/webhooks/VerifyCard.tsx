'use client'

/**
 * Verify a delivery — the signature scheme, the delivery headers, and copy-paste
 * constant-time verifiers (Node + Go). Rendered on the Webhooks page so a developer
 * has everything to verify `X-Webhook-Signature` in one place. Self-contained
 * (its own copy control); the snippet source is the pure, unit-tested `./verify`.
 */
import { useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Copy, ShieldCheck } from '@hanzogui/lucide-icons-2'

import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  SIGNATURE_SCHEME,
  goVerifySnippet,
  nodeVerifySnippet,
} from './verify'
import { CopyButton } from '@hanzo/ui/product'

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      <XStack items="center" justify="space-between" px="$3" py="$2" bg="$color2" borderBottomWidth={1} borderColor="$borderColor">
        <Text fontSize="$1" color="$color10" className="hz-mono">
          {language}
        </Text>
        <CopyButton value={code} label="Copy code" id="webhook-verify" />
      </XStack>
      <YStack style={{ overflowX: 'auto' }} p="$3" bg="$color1">
        <Text fontSize="$2" color="$color12" className="hz-mono" style={{ whiteSpace: 'pre', display: 'block' }}>
          {code}
        </Text>
      </YStack>
    </YStack>
  )
}

function HeaderRow({ name, desc }: { name: string; desc: string }) {
  return (
    <XStack gap="$3" items="flex-start" flexWrap="wrap" py="$1">
      <Text fontSize="$2" color="$color12" className="hz-mono" width={190}>
        {name}
      </Text>
      <Text fontSize="$2" color="$color11" flex={1} minW={200}>
        {desc}
      </Text>
    </XStack>
  )
}

export function VerifyCard() {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
      <XStack gap="$2" items="center">
        <ShieldCheck size={16} />
        <Text fontSize="$5" fontWeight="700" color="$color12">
          Verify a delivery
        </Text>
      </XStack>

      <Text fontSize="$2" color="$color11">
        Each delivery is signed with the endpoint&apos;s secret. Compute the same HMAC over the raw body and compare it in
        constant time — verify BEFORE parsing JSON, since a re-serialized body won&apos;t match the signature.
      </Text>
      <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" p="$3" bg="$color1">
        <Text fontSize="$2" color="$color12" className="hz-mono" style={{ whiteSpace: 'pre-wrap' }}>
          {SIGNATURE_SCHEME}
        </Text>
      </YStack>

      <YStack pt="$1">
        <HeaderRow name={SIGNATURE_HEADER} desc="t=<unix>,v1=<hmac-sha256 hex>. Verify this." />
        <HeaderRow name={EVENT_HEADER} desc="The event subject that fired, e.g. commerce.order.created." />
        <HeaderRow name={DELIVERY_HEADER} desc="A unique id for this delivery attempt — log it for idempotency." />
      </YStack>

      <CodeBlock language="Node.js" code={nodeVerifySnippet()} />
      <CodeBlock language="Go" code={goVerifySnippet()} />
    </Card>
  )
}
