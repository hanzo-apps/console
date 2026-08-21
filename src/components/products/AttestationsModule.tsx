'use client'

/**
 * Attestations — verifiable proofs (TEE/TDX remote attestation, signed build
 * provenance, on-chain attestations) the platform issues alongside a workload.
 *
 * Cloud routes no attestation ledger (HIP-0139), so the page says what a proof IS
 * instead of polling an address that answers nothing. It grows a table the day
 * there is a ledger to fill it.
 */
import { EmptyState, PageHeader } from '@hanzo/ui/product'
import { ShieldCheck } from '@hanzogui/lucide-icons-2'

export function AttestationsModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader
        title="Attestations"
        subtitle="Verifiable proofs — TEE remote attestation, build provenance, on-chain attestations."
      />

      <EmptyState
        icon={ShieldCheck}
        title="No attestation ledger here"
        description="An attestation is a signed claim you can check for yourself — the enclave a workload ran in, the commit an image was built from, a fact written to a chain. Hanzo issues them with the workload; this deployment serves no ledger to read them back from."
      />
    </>
  )
}
