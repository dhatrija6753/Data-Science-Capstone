import { useRouter } from 'expo-router'
import { useEffect } from 'react'

export default function InviteScreen() {
  const router = useRouter()
  useEffect(() => { router.back() }, [])
  return null
}