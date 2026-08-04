'use client'

/**
 * TEMPORARY probe — delete after use.
 *
 * Renders one gui element with `tag` and one with `render` so the served HTML says
 * which prop actually picks the host element. gui drops a prop it does not know
 * without erroring, so this question cannot be answered by the type-checker or by a
 * green build; it has to be asked of the renderer.
 */
import { XStack } from '@hanzo/gui'

export default function GuiProbe() {
  return (
    <div>
      <div id="probe-tag">
        <XStack {...({ tag: 'a', href: 'https://hanzo.ai' } as never)}>tag</XStack>
      </div>
      <div id="probe-render">
        <XStack render="a" {...({ href: 'https://hanzo.ai' } as never)}>render</XStack>
      </div>
    </div>
  )
}
