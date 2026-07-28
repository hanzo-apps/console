/**
 * The console's GUI config IS the shared one. The type/radius/space scale used to be
 * declared here; it now ships with the components it scales (`@hanzo/ui/gui-config`),
 * because the dedicated Hanzo Social app renders the same @hanzo/ui/product set and a
 * second copy of the ladder would fork silently — same components, different sizes.
 *
 * Kept as a file so `~/gui.config` stays the console's one import path.
 */
export { config, default } from '@hanzo/ui/gui-config'

export type Conf = typeof import('@hanzo/ui/gui-config').config
