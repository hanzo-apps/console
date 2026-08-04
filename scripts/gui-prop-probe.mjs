/**
 * Asks the RENDERER which props @hanzo/gui 8 actually honors.
 *
 * gui accepts any prop and drops the ones it does not know, so a gui-7 `tag="a"`
 * type-checks, builds, and ships a <div>: the link is inert and nothing anywhere says
 * so. A green build cannot answer this; only the rendered markup can. Every rule in
 * `src/lib/gui8-props.ts` was verified here before it was written down.
 *
 * gui injects its stylesheet as a leading <style>, so read the host element from the
 * marked child — never from the first tag in the string.
 *
 *   node scripts/gui-prop-probe.mjs      (slow: it resolves ~184 unbundled ESM packages)
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultConfig } from '@hanzogui/config/v5'
import { XStack, Text, createGui, GuiProvider } from '@hanzo/gui'

const config = createGui(defaultConfig)
const render = (el) =>
  renderToStaticMarkup(React.createElement(GuiProvider, { config, defaultTheme: 'dark' }, el))

/** The element carrying our marker id — not gui's injected <style>. */
const marked = (markup) => markup.match(/<([a-z]+)[^>]*\bid="probe"[^>]*>/)?.[0] ?? ''
const hostOf = (markup) => marked(markup).match(/^<([a-z]+)/)?.[1] ?? '(not found)'

const probe = (label, Comp, props) => {
  const markup = render(React.createElement(Comp, { id: 'probe', ...props }, 'x'))
  console.log(`${label.padEnd(30)} -> ${marked(markup) || '(not found)'}`)
  return { host: hostOf(markup), markup }
}

console.log('--- host element: tag (gui 7) vs render (gui 8) ---')
const withTag = probe('tag="a"', XStack, { tag: 'a', href: 'https://hanzo.ai' })
const withRender = probe('render="a"', XStack, { render: 'a', href: 'https://hanzo.ai' })

console.log('\n--- style props that silently drop or mis-unit ---')
probe('lineHeight={1.1} (prop)', Text, { lineHeight: 1.1 })
probe('style lineHeight: 1.1 (ratio)', Text, { style: { lineHeight: 1.1 } })
probe("style lineHeight: '1.1' (string)", Text, { style: { lineHeight: '1.1' } })
probe('letterSpacing="-0.02em"', Text, { letterSpacing: '-0.02em' })
probe('animation="quick"', XStack, { animation: 'quick' })
probe('$sm={{...}}', XStack, { $sm: { bg: '$red10' } })
probe('$gtSm={{...}}', XStack, { $gtSm: { bg: '$red10' } })

console.log()
console.log(withTag.host === 'a' ? 'tag    WORKS' : 'tag    IS SILENTLY DROPPED')
console.log(withRender.host === 'a' ? 'render WORKS' : 'render IS SILENTLY DROPPED')
