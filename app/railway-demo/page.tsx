'use client'

/**
 * Design-reference route — renders the ProductLanding kit + the RailwayDeploy pipeline
 * in its lifecycle states OFFLINE (static status props, no backend, no auth), so the
 * landing/pipeline design can be reviewed and screenshotted from `next dev` without a
 * live session. Data-free by construction; not linked from the product nav.
 */
import { Boxes, DollarSign, FileText, Gauge, Layers, Plus, Search, Sparkles } from '@hanzogui/lucide-icons-2'
import { Card, Text, XStack, YStack } from '@hanzo/gui'

import { ProductLanding, apiBaseFromDocs, type LandingMetric, type ProductLandingConfig } from '~/components/products/landing'
import { RailwayDeploy } from '~/components/products/paas/RailwayDeploy'
import { embeddingsCodeSamples } from '~/components/products/embeddings/logic'

const metrics: LandingMetric[] = [
  { key: 'collections', label: 'Collections', value: 12, format: (n) => Math.round(n).toLocaleString(), icon: <Boxes size={14} opacity={0.6} /> },
  { key: 'documents', label: 'Documents indexed', value: 3420, format: (n) => Math.round(n).toLocaleString(), icon: <FileText size={14} opacity={0.6} /> },
  { key: 'vectors', label: 'Total vectors', value: 184213, format: (n) => Math.round(n).toLocaleString(), series: [120, 138, 150, 171, 184], deltaPct: 12, icon: <Layers size={14} opacity={0.6} /> },
  { key: 'queries', label: 'Queries (7D)', value: 8241, format: (n) => Math.round(n).toLocaleString(), series: [900, 1100, 1050, 1300, 1450], deltaPct: 8, icon: <Search size={14} opacity={0.6} /> },
  { key: 'latency', label: 'Avg latency', value: 42, format: (n) => `${Math.round(n)} ms`, series: [55, 50, 47, 44, 42], deltaPct: -6, icon: <Gauge size={14} opacity={0.6} /> },
  { key: 'cost', label: 'Cost (7D)', value: null, format: (n) => `$${(n / 100).toFixed(2)}`, icon: <DollarSign size={14} opacity={0.6} />, hint: 'Awaiting metering' },
]

const landingConfig: ProductLandingConfig = {
  productId: 'embeddings',
  title: 'Vector embeddings & semantic search',
  tagline: 'Generate, store, and search embeddings at scale — one API for semantic search and RAG, powered by Zen embedding models.',
  icon: Boxes,
  docsProduct: 'embeddings',
  primary: { label: 'Create collection', icon: <Plus size={16} />, onPress: () => {} },
  secondary: { label: 'Try search', icon: <Search size={15} />, onPress: () => {} },
  metrics,
  samples: embeddingsCodeSamples(apiBaseFromDocs('https://docs.hanzo.ai'), 'zen-embedding'),
  run: { label: 'Generate in console', icon: <Sparkles size={14} />, onPress: () => {} },
  actions: [
    { label: 'Create collection', icon: <Plus size={15} />, onPress: () => {} },
    { label: 'Explore search', icon: <Search size={15} />, onPress: () => {} },
    { label: 'Generate embeddings', icon: <Sparkles size={15} />, onPress: () => {} },
  ],
}

function RailCard({ title, status }: { title: string; status: string }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" flex={1} minW={320}>
      <Text fontSize="$3" fontWeight="700" color="$color12">
        {title}
      </Text>
      <RailwayDeploy status={status} />
    </Card>
  )
}

export default function RailwayDemoPage() {
  return (
    <YStack gap="$6" p="$5" maxW={1180} self="center" width="100%">
      <Text fontSize="$9" fontWeight="900">RailwayDeploy pipeline</Text>
      <XStack gap="$4" flexWrap="wrap">
        <RailCard title="Building (in progress)" status="building" />
        <RailCard title="Deploying (in progress)" status="deploying" />
        <RailCard title="Live" status="live" />
        <RailCard title="Failed" status="error" />
      </XStack>

      <Text fontSize="$9" fontWeight="900">Embeddings landing (ProductLanding kit)</Text>
      <ProductLanding config={landingConfig} />
    </YStack>
  )
}
