import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

export default function HomeScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userName, setUserName] = useState('')
  const [totalOwedToMe, setTotalOwedToMe] = useState(0)
  const [totalIOwe, setTotalIOwe] = useState(0)
  const [recentBills, setRecentBills] = useState<any[]>([])
  const [groupCount, setGroupCount] = useState(0)

  useFocusEffect(
    useCallback(() => {
      loadDashboard()
    }, [])
  )

  async function loadDashboard() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Load profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
    setUserName(profile?.full_name?.split(' ')[0] || 'there')

    // Load groups count
    const { count: gCount } = await supabase
      .from('group_members')
      .select('group_id', { count: 'exact' })
      .eq('user_id', user.id)
    setGroupCount(gCount || 0)

    // Load bills I paid and how much others owe me
    const { data: myBills } = await supabase
      .from('bills')
      .select('id, total_amount, description, store_name, bill_date, group_id, groups(name)')
      .eq('paid_by', user.id)
      .order('bill_date', { ascending: false })
      .limit(10)

    let owedToMe = 0
    if (myBills && myBills.length > 0) {
      const { data: othersSplits } = await supabase
        .from('bill_splits')
        .select('amount_owed')
        .in('bill_id', myBills.map(b => b.id))
        .neq('user_id', user.id)
      owedToMe = othersSplits?.reduce((s: number, r: any) => s + (r.amount_owed || 0), 0) || 0
    }
    setTotalOwedToMe(parseFloat(owedToMe.toFixed(2)))

    // Load what I owe others
    const { data: mySplits } = await supabase
      .from('bill_splits')
      .select('amount_owed, bill_id')
      .eq('user_id', user.id)

    let iOwe = 0
    if (mySplits && mySplits.length > 0) {
      const { data: notMyBills } = await supabase
        .from('bills')
        .select('id')
        .in('id', mySplits.map(s => s.bill_id))
        .neq('paid_by', user.id)

      const notMyBillIds = new Set(notMyBills?.map(b => b.id) || [])
      iOwe = mySplits
        .filter(s => notMyBillIds.has(s.bill_id))
        .reduce((s: number, r: any) => s + (r.amount_owed || 0), 0)
    }
    setTotalIOwe(parseFloat(iOwe.toFixed(2)))

    // Recent bills across all groups
    const { data: groupIds } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)

    if (groupIds && groupIds.length > 0) {
      const { data: recent } = await supabase
        .from('bills')
        .select('id, group_id, description, store_name, total_amount, bill_date, groups(name)')
        .in('group_id', groupIds.map(g => g.group_id))
        .order('bill_date', { ascending: false })
        .limit(5)
      setRecentBills(recent || [])
    }

    setLoading(false)
  }

  async function onRefresh() {
    setRefreshing(true)
    await loadDashboard()
    setRefreshing(false)
  }

  const netBalance = totalOwedToMe - totalIOwe
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
    </View>
  )

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1DB954" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.userName}>{userName} 👋</Text>
        </View>
        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Text style={styles.avatarBtnText}>
            {userName?.[0]?.toUpperCase() || '?'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Balance Card */}
      <View style={[styles.balanceCard, { backgroundColor: netBalance >= 0 ? '#1DB954' : '#e53935' }]}>
        <Text style={styles.balanceLabel}>
          {netBalance >= 0 ? 'You are owed' : 'You owe'}
        </Text>
        <Text style={styles.balanceAmount}>${Math.abs(netBalance).toFixed(2)}</Text>
        <View style={styles.balanceRow}>
          <View style={styles.balanceSub}>
            <Ionicons name="arrow-down-circle-outline" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.balanceSubText}>Owed to you ${totalOwedToMe.toFixed(2)}</Text>
          </View>
          <View style={styles.balanceSub}>
            <Ionicons name="arrow-up-circle-outline" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.balanceSubText}>You owe ${totalIOwe.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/scan')}
        >
          <View style={[styles.actionIcon, { backgroundColor: '#e8f9ee' }]}>
            <Ionicons name="camera" size={26} color="#1DB954" />
          </View>
          <Text style={styles.actionTitle}>Scan Receipt</Text>
          <Text style={styles.actionSub}>AI-powered OCR</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/groups')}
        >
          <View style={[styles.actionIcon, { backgroundColor: '#e3f2fd' }]}>
            <Ionicons name="people" size={26} color="#1976D2" />
          </View>
          <Text style={styles.actionTitle}>My Groups</Text>
          <Text style={styles.actionSub}>{groupCount} active</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/analytics')}
        >
          <View style={[styles.actionIcon, { backgroundColor: '#f3e5f5' }]}>
            <Ionicons name="bar-chart" size={26} color="#9C27B0" />
          </View>
          <Text style={styles.actionTitle}>Analytics</Text>
          <Text style={styles.actionSub}>Your spending</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => router.push('/(tabs)/groups?settle=1')}
        >
          <View style={[styles.actionIcon, { backgroundColor: '#fff3e0' }]}>
            <Ionicons name="checkmark-done" size={26} color="#F57C00" />
          </View>
          <Text style={styles.actionTitle}>Settle Up</Text>
          <Text style={styles.actionSub}>Clear debts</Text>
        </TouchableOpacity>
      </View>

      {/* Recent Bills */}
      <Text style={styles.sectionTitle}>Recent Bills</Text>
      {recentBills.length === 0 ? (
        <View style={styles.emptyBills}>
          <Ionicons name="receipt-outline" size={48} color="#ddd" />
          <Text style={styles.emptyBillsText}>No bills yet</Text>
          <Text style={styles.emptyBillsSub}>Scan a receipt to get started</Text>
          <TouchableOpacity
            style={styles.scanNowBtn}
            onPress={() => router.push('/(tabs)/scan')}
          >
            <Ionicons name="camera-outline" size={18} color="#fff" />
            <Text style={styles.scanNowText}>Scan Now</Text>
          </TouchableOpacity>
        </View>
      ) : (
        recentBills.map((bill) => (
          <TouchableOpacity
            key={bill.id}
            style={styles.billRow}
            onPress={() => router.push(
              `/(tabs)/group/bill-detail?billId=${bill.id}&groupId=${bill.group_id}`
            )}
            activeOpacity={0.7}
          >
            <View style={styles.billIcon}>
              <Ionicons name="receipt-outline" size={20} color="#1DB954" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.billName} numberOfLines={1}>
                {bill.store_name || bill.description}
              </Text>
              <Text style={styles.billGroup}>
                {bill.groups?.name} · {bill.bill_date
                  ? new Date(bill.bill_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : ''}
              </Text>
            </View>
            <View style={styles.billRight}>
              <Text style={styles.billAmount}>${bill.total_amount?.toFixed(2)}</Text>
              <View style={styles.billChevron}>
                <Ionicons name="chevron-forward" size={16} color="#ccc" />
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}

      {/* Powered by badge */}
      <View style={styles.poweredBy}>
        <Ionicons name="flash-outline" size={14} color="#bbb" />
        <Text style={styles.poweredByText}>
          Powered by Groq AI · Kroger API · Supabase
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 20, paddingTop: 60,
  },
  greeting: { fontSize: 15, color: '#999' },
  userName: { fontSize: 24, fontWeight: '800', color: '#1a1a1a' },
  avatarBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  avatarBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  balanceCard: {
    margin: 16, borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12,
  },
  balanceLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '500' },
  balanceAmount: { color: '#fff', fontSize: 42, fontWeight: '800', marginVertical: 6 },
  balanceRow: { flexDirection: 'row', gap: 20, marginTop: 4 },
  balanceSub: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  balanceSubText: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },

  sectionTitle: {
    fontSize: 18, fontWeight: '700', color: '#1a1a1a',
    paddingHorizontal: 20, marginTop: 20, marginBottom: 12,
  },

  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, gap: 10,
  },
  actionCard: {
    width: '46%', marginLeft: 8,
    backgroundColor: '#f9f9f9', borderRadius: 16, padding: 16,
  },
  actionIcon: {
    width: 50, height: 50, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  actionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  actionSub: { fontSize: 12, color: '#999', marginTop: 2 },

  billRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5', gap: 12,
  },
  billIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#e8f9ee', justifyContent: 'center', alignItems: 'center',
  },
  billName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  billGroup: { fontSize: 12, color: '#999', marginTop: 2 },
  billRight: { alignItems: 'flex-end', gap: 4 },
  billAmount: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  billChevron: { alignItems: 'flex-end' },

  emptyBills: {
    alignItems: 'center', padding: 36, gap: 8,
  },
  emptyBillsText: { fontSize: 18, fontWeight: '600', color: '#ccc' },
  emptyBillsSub: { fontSize: 14, color: '#ddd' },
  scanNowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1DB954', paddingHorizontal: 20,
    paddingVertical: 12, borderRadius: 12, marginTop: 8,
  },
  scanNowText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  poweredBy: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 24, paddingBottom: 8,
  },
  poweredByText: { fontSize: 12, color: '#bbb' },
})
