/**
 * Hermetic unit-test stub for `@hanzo/gui`.
 *
 * Unit tests import the real module graph (registry → product modules) to
 * exercise PURE logic and data-integrity, but never render it — so every gui
 * export is a no-op placeholder. Real rendering + interaction is covered by the
 * Playwright E2E suite against the live Next server. Exports mirror exactly the
 * named imports used across `src/` (see test/stubs/README intent).
 */
const Dummy = (_props?: unknown): null => null

export const Button = Dummy
export const Card = Dummy
export const GuiProvider = Dummy
export const Input = Dummy
export const Label = Dummy
export const ScrollView = Dummy
export const Select = Dummy
export const Slider = Dummy
export const Spinner = Dummy
export const Switch = Dummy
export const Text = Dummy
export const TextArea = Dummy
export const XStack = Dummy
export const YStack = Dummy
export const useTheme = (): Record<string, unknown> => ({})

export default Dummy
