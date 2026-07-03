import { defaultConfig } from '@hanzogui/config/v5'
import { createGui } from '@hanzo/gui'

// Canonical Hanzo UI face: Basel Grotesk (self-hosted via app/globals.css @font-face),
// paired with Geist Mono for code/data. Override the @hanzo/gui (Tamagui) v5 default
// system-font family on the body + heading fonts so every <Text>/<Paragraph>/<H*>
// renders Basel — one place, whole product (DRY). Size/line-height/weight scales are
// inherited from the default config; only the family swaps.
const BASEL =
  "'Basel', -apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export const config = createGui({
  ...defaultConfig,
  fonts: {
    ...defaultConfig.fonts,
    body: { ...defaultConfig.fonts.body, family: BASEL },
    heading: { ...defaultConfig.fonts.heading, family: BASEL },
  },
})

export default config

export type Conf = typeof config
