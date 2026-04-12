import { Stack } from 'expo-router'

// This layout wraps all group/* screens in a Stack navigator.
// Without this file, Expo Router exposes each file (add-expense, settle, [id])
// as a loose route inside the Tabs, which causes phantom "group..." tabs in the tab bar.
export default function GroupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  )
}
