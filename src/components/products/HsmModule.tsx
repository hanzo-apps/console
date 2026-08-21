'use client'

/**
 * HSM — hardware security modules that back key custody (PKCS#11 partitions,
 * cloud-KMS HSM backends) for the platform's signing and encryption keys.
 *
 * Cloud routes no HSM inventory (HIP-0139): the keys themselves are reached through
 * Hanzo KMS (`/v1/kms/secrets`), and the hardware under them is not a surface this
 * deployment lists. The page says so rather than polling an address that answers
 * nothing.
 */
import { EmptyState, PageHeader } from '@hanzo/ui/product'
import { Fingerprint } from '@hanzogui/lucide-icons-2'

export function HsmModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader title="HSM" subtitle="Hardware security modules — key custody backends." />

      <EmptyState
        icon={Fingerprint}
        title="Key custody lives in KMS"
        description="Signing and encryption keys are held by Hanzo KMS, which keeps the private half inside hardware you never handle. The partitions and backends behind it are operated by Hanzo and are not listed here."
      />
    </>
  )
}
