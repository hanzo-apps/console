/**
 * Renders a gui element twice — once with `tag`, once with `render` — and prints
 * the host element each produced.
 *
 * gui accepts any prop and drops the ones it does not know, so a `tag="a"` left
 * over from gui 7 type-checks, builds, and ships a <div>: the link is inert and
 * nothing anywhere says so. This asks the renderer directly rather than reading
 * the bundle, because the bundle is what the source SAYS and this is what it DOES.
 *
 *   node scripts/gui-prop-probe.mjs
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultConfig } from '@hanzogui/config/v5'
import { XStack, createGui, GuiProvider } from '@hanzo/gui'

const config = createGui(defaultConfig)
const wrap = (el) => React.createElement(GuiProvider, { config, defaultTheme: 'dark' }, el)

const host = (markup) => markup.match(/^<([a-z]+)/)?.[1] ?? '(none)'

const withTag = renderToStaticMarkup(
  wrap(React.createElement(XStack, { tag: 'a', href: 'https://hanzo.ai' }, 'link')),
)
const withRender = renderToStaticMarkup(
  wrap(React.createElement(XStack, { render: 'a', href: 'https://hanzo.ai' }, 'link')),
)

console.log('tag="a"    ->', host(withTag), '|', withTag.slice(0, 120))
console.log('render="a" ->', host(withRender), '|', withRender.slice(0, 120))
console.log(host(withTag) === 'a' ? 'TAG WORKS' : 'TAG IS SILENTLY DROPPED')
