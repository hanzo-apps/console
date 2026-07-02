'use client'

import dynamic from 'next/dynamic'

// GUI-free at module scope: the heavy product tree (registry + react-native-web)
// is pulled in ONLY by this lazy import, which `ssr: false` keeps off the
// static-export prerender. The server `page.tsx` renders this wrapper; the client
// resolves the URL segments and renders the matched product module.
const Inner = dynamic(() => import('./ProductPageClient').then((m) => m.ProductPageClient), { ssr: false })

export function ProductPageLazy({ slug }: { slug: string[] }) {
  return <Inner slug={slug} />
}
