'use client'

/**
 * The bot deploy form — renders a `BotTemplate`'s config SCHEMA as controls, then
 * deploys via the existing `PaasApi` (createProject → createApp(git) → deploy). The
 * PaaS BuildKit builds the template's repo/Dockerfile → GHCR → deploys it per-org;
 * there is no bespoke deploy path here. A `secretRef` field is shown as a read-only
 * KMS key name — its VALUE is NEVER typed in the browser (it rides a KMSSecret sync).
 */
import { useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'

import { FieldRow, FieldText, FieldSelect } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { PageHeader } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { PaasApi } from '~/lib/api/paas'
import {
  type BotTemplate,
  type BotDeployValues,
  validateBotDeploy,
  toCreateAppInput,
} from '~/lib/products/trading/templates'

/** Ensure a project exists for the org's trading bots and return its slug. */
async function ensureTradingProject(): Promise<string> {
  const slug = 'trading-bots'
  const projects = await PaasApi.listProjects().catch(() => [])
  const existing = projects.find((p) => (p.slug || p.id) === slug || p.name === 'Trading Bots')
  if (existing) return existing.slug || existing.id
  const created = await PaasApi.createProject({ name: 'Trading Bots', slug, description: 'Lux DEX market-maker and trader bots.' })
  return created.slug || created.id
}

export function DeployForm({ template, onDone, onCancel }: { template: BotTemplate; onDone: () => void; onCancel: () => void }) {
  const firstNet = template.networks[0]?.id ?? ''
  const [network, setNetwork] = useState(firstNet)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.fields.map((f) => [f.key, f.default])),
  )
  const [name, setName] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const net = template.networks.find((n) => n.id === network)
  const deployValues: BotDeployValues = useMemo(() => ({ network, values, name: name || undefined }), [network, values, name])
  const problems = useMemo(() => validateBotDeploy(template, deployValues), [template, deployValues])

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }))

  const deploy = async () => {
    setDeploying(true)
    setError(null)
    try {
      const project = await ensureTradingProject()
      const input = toCreateAppInput(template, deployValues)
      const app = await PaasApi.createApp(project, input)
      // Kick the first build+deploy (BuildKit builds the git repo → GHCR → deploy).
      await PaasApi.deploy(project, app.slug || app.id, {}).catch(() => undefined)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeploying(false)
    }
  }

  return (
    <YStack gap="$4">
      <PageHeader
        title={`Deploy ${template.label}`}
        subtitle={template.description}
      />

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$4">
        <FieldRow label="Network">
          <FieldSelect
            value={network}
            options={template.networks.map((n) => n.id)}
            onChange={setNetwork}
            placeholder="Select a network…"
          />
        </FieldRow>

        {net?.mainnet ? (
          <XStack gap="$2" items="center">
            <StatusTag status="yellow" />
            <Text fontSize="$2" color="$color11">
              Mainnet trades REAL value — supply real market addresses, keep the taker probe off, and deploy only after go-live sign-off.
            </Text>
          </XStack>
        ) : null}

        <FieldRow label="App name">
          <FieldText value={name} onChange={setName} placeholder={`${template.id}-${network || 'network'}`} />
        </FieldRow>

        {template.fields.map((f) => {
          if (f.kind === 'secretRef') {
            return (
              <FieldRow key={f.key} label={f.label}>
                <YStack gap="$1.5">
                  <XStack
                    bg="$color3"
                    borderWidth={1}
                    borderColor="$borderColor"
                    rounded="$3"
                    px="$3"
                    py="$2"
                    items="center"
                    gap="$2"
                  >
                    <Text fontSize="$2" color="$color11" style={{ fontFamily: 'monospace' }}>
                      {f.default}
                    </Text>
                    <StatusTag status="neutral" />
                  </XStack>
                  <Text fontSize="$1" color="$color10">
                    {f.help}
                  </Text>
                </YStack>
              </FieldRow>
            )
          }
          const placeholder =
            template.id === 'market-maker' && f.env === 'COHERENCE_MARKETS' && net
              ? net.markets || 'SYMBOL=SOURCE:BASE:QUOTE,…'
              : f.default
          return (
            <FieldRow key={f.key} label={f.label}>
              <YStack gap="$1.5">
                <FieldText value={values[f.key] ?? ''} onChange={(v) => setField(f.key, v)} placeholder={placeholder} />
                <Text fontSize="$1" color="$color10">
                  {f.help}
                </Text>
              </YStack>
            </FieldRow>
          )
        })}

        {problems.length > 0 ? (
          <YStack gap="$1">
            {problems.map((p) => (
              <Text key={p} fontSize="$2" color="$red10">
                {p}
              </Text>
            ))}
          </YStack>
        ) : null}

        {error ? (
          <Card bg="$red3" borderColor="$red7" borderWidth={1} p="$3">
            <Text fontSize="$2" color="$red11">
              Deploy failed — {error}
            </Text>
          </Card>
        ) : null}

        <XStack gap="$3" justify="flex-end">
          <Button size="$3" onPress={onCancel} disabled={deploying}>
            Cancel
          </Button>
          <PrimaryButton size="$3" onPress={deploy} disabled={deploying || problems.length > 0}>
            {deploying ? 'Deploying…' : 'Deploy bot'}
          </PrimaryButton>
        </XStack>

        <Text fontSize="$1" color="$color10">
          Builds {template.repo} on the Hanzo PaaS (BuildKit → {template.image}) and deploys it to your org as a singleton.
        </Text>
      </Card>
    </YStack>
  )
}
