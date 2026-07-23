'use client'

/**
 * Sign-in route. The whole experience (tenant credential form / admin silent SSO)
 * lives in the shared `<SignIn/>` component, which `Auth` also renders — so a
 * direct `/signin` load resolves to the form whether it mounts this route or the
 * dashboard shell (the deploy serves the SPA shell for every path).
 */
import { SignIn } from '~/components/SignIn'

export default function SignInPage() {
  return <SignIn />
}
