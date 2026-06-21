'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { SignInForm } from '~/components/SignInForm'
import { useSession } from '~/lib/auth/session'

export default function SignInPage() {
  const { account, loading } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (!loading && account) router.replace('/')
  }, [loading, account, router])

  return <SignInForm />
}
