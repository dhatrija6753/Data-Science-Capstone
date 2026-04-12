import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ScrollView, ActivityIndicator
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function ProfileScreen() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [stats, setStats] = useState({
    groupCount: 0,
    billCount: 0,
    totalPaid: 0,
    totalOwed: 0,
  })

  useFocusEffect(
    useCallback(() => {
      loadProfile()
    }, [])
  )

  async function loadProfile() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUser(user)

    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    setProfile(prof)
    setNewName(prof?.full_name || '')

    // Load stats
    const [groupsRes, splitsRes] = await Promise.all([
      supabase.from('group_members').select('id', { count: 'exact' }).eq('user_id', user.id),
      supabase.from('bill_splits').select('amount_owed').eq('user_id', user.id),
    ])

    const totalOwed = splitsRes.data?.reduce((s: number, r: any) => s + (r.amount_owed || 0), 0) || 0

    // Bills where the user was the payer
    const { data: paidBills } = await supabase
      .from('bills')
      .select('total_amount')
      .eq('paid_by', user.id)
    const totalPaid = paidBills?.reduce((s: number, b: any) => s + (b.total_amount || 0), 0) || 0

    setStats({
      groupCount: groupsRes.count || 0,
      billCount: splitsRes.data?.length || 0,
      totalPaid: parseFloat(totalPaid.toFixed(2)),
      totalOwed: parseFloat(totalOwed.toFixed(2)),
    })

    setLoading(false)
  }

  async function saveName() {
    if (!newName.trim() || !user) return
    setSavingName(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: newName.trim() })
      .eq('id', user.id)

    if (error) Alert.alert('Error', error.message)
    else {
      setProfile((prev: any) => ({ ...prev, full_name: newName.trim() }))
      setEditingName(false)
    }
    setSavingName(false)
  }

  async function signOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          // Root layout's onAuthStateChange listener will redirect to login automatically
        },
      },
    ])
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
    </View>
  )

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?'

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* Avatar + Name */}
      <View style={styles.heroSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        {editingName ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={newName}
              onChangeText={setNewName}
              autoFocus
              placeholder="Your name"
            />
            <TouchableOpacity style={styles.saveBtn} onPress={saveName} disabled={savingName}>
              <Text style={styles.saveBtnText}>{savingName ? '...' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditingName(false)}>
              <Ionicons name="close-circle" size={28} color="#ccc" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.nameRow} onPress={() => setEditingName(true)}>
            <Text style={styles.name}>{profile?.full_name || 'Add your name'}</Text>
            <Ionicons name="pencil-outline" size={16} color="#999" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        )}

        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.groupCount}</Text>
          <Text style={styles.statLabel}>Groups</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.billCount}</Text>
          <Text style={styles.statLabel}>Bills Split</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#1DB954' }]}>${stats.totalPaid.toFixed(0)}</Text>
          <Text style={styles.statLabel}>You Paid</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#e53935' }]}>${stats.totalOwed.toFixed(0)}</Text>
          <Text style={styles.statLabel}>Your Share</Text>
        </View>
      </View>

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.settingRow}>
          <Ionicons name="mail-outline" size={20} color="#999" />
          <Text style={styles.settingLabel}>Email</Text>
          <Text style={styles.settingValue} numberOfLines={1}>{user?.email}</Text>
        </View>

        <View style={styles.settingRow}>
          <Ionicons name="calendar-outline" size={20} color="#999" />
          <Text style={styles.settingLabel}>Joined</Text>
          <Text style={styles.settingValue}>
            {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
              month: 'long', year: 'numeric'
            }) : '—'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>

        <View style={styles.settingRow}>
          <Ionicons name="code-slash-outline" size={20} color="#999" />
          <Text style={styles.settingLabel}>Version</Text>
          <Text style={styles.settingValue}>1.0.0</Text>
        </View>

        <View style={styles.settingRow}>
          <Ionicons name="school-outline" size={20} color="#999" />
          <Text style={styles.settingLabel}>Project</Text>
          <Text style={styles.settingValue}>Data Science Capstone</Text>
        </View>

        <View style={styles.settingRow}>
          <Ionicons name="location-outline" size={20} color="#999" />
          <Text style={styles.settingLabel}>Region</Text>
          <Text style={styles.settingValue}>DMV Area</Text>
        </View>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
        <Ionicons name="log-out-outline" size={20} color="#e53935" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        SplitSmart · Built for DMV students
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  heroSection: {
    alignItems: 'center', paddingTop: 70,
    paddingBottom: 28, backgroundColor: '#f9f9f9',
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    marginBottom: 24,
  },
  avatar: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: '#1DB954', justifyContent: 'center',
    alignItems: 'center', marginBottom: 14,
    shadowColor: '#1DB954', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '800' },

  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  name: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  nameEditRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginBottom: 4, paddingHorizontal: 20,
  },
  nameInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, padding: 10, fontSize: 16,
  },
  saveBtn: {
    backgroundColor: '#1DB954', paddingHorizontal: 14,
    paddingVertical: 10, borderRadius: 10,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  email: { fontSize: 14, color: '#999', marginTop: 2 },

  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, gap: 10, marginBottom: 24,
  },
  statCard: {
    width: '47%', backgroundColor: '#f9f9f9',
    borderRadius: 14, padding: 16, alignItems: 'center',
  },
  statValue: { fontSize: 26, fontWeight: '800', color: '#1a1a1a' },
  statLabel: { fontSize: 13, color: '#999', marginTop: 2 },

  section: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: '#f9f9f9', borderRadius: 16, overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#f0f0f0', gap: 12,
  },
  settingLabel: { flex: 1, fontSize: 15, color: '#333' },
  settingValue: { fontSize: 14, color: '#999', maxWidth: 180, textAlign: 'right' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 16,
    padding: 16, backgroundColor: '#fff5f5',
    borderRadius: 14, borderWidth: 1.5, borderColor: '#ffcdd2',
  },
  signOutText: { fontSize: 16, color: '#e53935', fontWeight: '600' },

  footer: {
    textAlign: 'center', fontSize: 12,
    color: '#ccc', paddingBottom: 20,
  },
})
