'use client'

/**
 * The console home. See src/components/home/Home.tsx for why it is the model
 * lineup and an account's own figures rather than a catalog of every product:
 * a signed-in account has stopped asking what we sell.
 *
 * The catalog is not deleted — it is opt-in, reached from Manage, so the
 * products remain one click away instead of standing in front of the API.
 */
import { Home } from '~/components/home/Home'

export default function Page() {
  return <Home />
}
