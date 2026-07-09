import { defaultConfig } from '@hanzogui/config/v5'
import { createGui } from '@hanzo/gui'

// Canonical Hanzo UI face: Geist Sans (loaded via the CDN @import in app/globals.css,
// parallel to Geist Mono for code/data). Override the @hanzo/gui (Tamagui) v5 default
// system-font family on the body + heading fonts so every <Text>/<Paragraph>/<H*>
// renders Geist — one place, whole product (DRY). Size/line-height/weight scales are
// inherited from the default config; only the family swaps. Falls back to system-ui
// if the Geist face is unavailable, so the UI degrades gracefully.
const GEIST = "'Geist', system-ui, -apple-system, sans-serif"

export const config = createGui({
  ...defaultConfig,
  fonts: {
    ...defaultConfig.fonts,
    body: { ...defaultConfig.fonts.body, family: GEIST },
    heading: { ...defaultConfig.fonts.heading, family: GEIST },
  },
})

export default config

export type Conf = typeof config
