'use client'

/**
 * Connect-GPU drawer — the BYO ("bring your own") sibling of LaunchDrawer. Where
 * LaunchDrawer DEPLOYS a cloud GPU (visor/DOKS), this shows how to CONNECT hardware
 * the user already owns: the `hanzo gpu connect` CLI (or the Desktop toggle) registers
 * the machine in the org's fleet, where it shows up below with a BYO badge and can run
 * Studio renders AND serve models. It is purely presentational (copy-to-run commands,
 * no transport) — the real work happens in the CLI's outbound, NAT-safe worker loop.
 */
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { Cable, HardDrive, Server } from '@hanzogui/lucide-icons-2'

import { CopyField } from '../resource/parts'

export function ConnectGpuDrawer(_props: { onClose: () => void }) {
  return (
    <YStack gap="$4">
      <Text fontSize="$3" color="$color11">
        Bring a machine you already own — a workstation, a server, a GB10 — into your org’s fleet.
        It dials out (NAT-safe: nothing to open inbound), appears below with a BYO badge, and can
        run Studio renders and serve models.
      </Text>

      <YStack gap="$3">
        <CopyField label="1 · Sign in" value="hanzo login" />
        <CopyField label="2 · Connect this machine’s GPU" value="hanzo gpu connect" />
      </YStack>

      <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color1">
        <XStack items="center" gap="$2">
          <Server size={15} color="$color11" />
          <Text fontSize="$3" fontWeight="700" color="$color12">
            Also serve models
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color11">
          Add the <Text color="$color12" fontWeight="700">--serve-engine</Text> flag to also run
          hanzo-engine (OpenAI + Anthropic) on this GPU and advertise its endpoint — so it can power
          chat, the API, and custom models, not just Studio renders.
        </Text>
        <CopyField label="Connect and serve models" value="hanzo gpu connect --serve-engine" />
      </Card>

      <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" borderStyle="dashed">
        <XStack items="center" gap="$2">
          <HardDrive size={15} color="$color11" />
          <Text fontSize="$3" fontWeight="700" color="$color12">
            Prefer a toggle?
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color11">
          In the Hanzo Desktop app, open Settings → Cloud GPU and turn on “Connect this device’s GPU
          to Hanzo Cloud.” Same fleet, one switch.
        </Text>
      </Card>

      <XStack items="center" gap="$2">
        <Cable size={13} color="$color10" />
        <Text fontSize="$1" color="$color10">
          Once connected the machine reports online within ~30s; `hanzo gpu disconnect` removes it.
        </Text>
      </XStack>
    </YStack>
  )
}
