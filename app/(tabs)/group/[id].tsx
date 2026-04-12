import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'

export default function GroupDetailScreen() {
  const params = useLocalSearchParams()
  const groupId = Array.isArray(params.id) ? params.id[0] : params.id as string
  const router = useRouter()

  const [group, setGroup] = useState<any>(null)
  const [bills, setBills] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [myBalance, setMyBalance] = useState(0)

  // Invite modal
  const [inviteVisible, setInviteVisible] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  // Group actions menu
  const [menuVisible, setMenuVisible] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  useFocusEffect(useCallback(() => { loadAll() }, [groupId]))

  async function loadAll() {
    if (!groupId) return
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUser(user)

      const { data: groupData } = await supabase
        .from('groups').select('*').eq('id', groupId).single()
      setGroup(groupData)

      const { data: billsData } = await supabase
        .from('bills')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
      setBills(billsData || [])

      const { data: membersData } = await supabase
        .from('group_members')
        .select('*, profiles(id, full_name)')
        .eq('group_id', groupId)
      setMembers(membersData || [])

      if (billsData && user) {
        await calculateMyBalance(billsData, user.id)
      }
    } catch (e) {
      console.log('loadAll error:', e)
    }
    setLoading(false)
  }

  async function calculateMyBalance(billsList: any[], userId: string) {
    let balance = 0
    for (const bill of billsList) {
      const { data: splits } = await supabase
        .from('bill_splits').select('*').eq('bill_id', bill.id)
      if (bill.paid_by === userId) balance += bill.total_amount
      splits?.forEach((split: any) => {
        if (split.user_id === userId) balance -= split.amount_owed
      })
    }
    const { data: settlements } = await supabase
      .from('settlements').select('*').eq('group_id', groupId)
    settlements?.forEach((s: any) => {
      if (s.from_user === userId) balance += s.amount
      if (s.to_user === userId) balance -= s.amount
    })
    setMyBalance(parseFloat(balance.toFixed(2)))
  }

  async function inviteMember() {
    const cleaned = inviteEmail.trim().toLowerCase()
    if (!cleaned) return Alert.alert('Error', 'Enter an email address')
    setInviting(true)

    const { data: userId, error: rpcError } = await supabase
      .rpc('get_user_id_by_email', { user_email: cleaned })

    if (rpcError || !userId) {
      Alert.alert('Not found', 'No SplitSmart account found with that email.')
      setInviting(false)
      return
    }

    const { data: existing } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existing) {
      Alert.alert('Already a member', 'That person is already in this group.')
      setInviting(false)
      return
    }

    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: groupId, user_id: userId, role: 'member' })

    if (error) {
      Alert.alert('Error', error.message)
      setInviting(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles').select('full_name').eq('id', userId).single()

    Alert.alert('Added! 🎉', `${profile?.full_name || cleaned} added to the group.`)
    setInviteEmail('')
    setInviteVisible(false)
    loadAll()
    setInviting(false)
  }

  // ── Leave Group ──────────────────────────────────────────────────────────────
  function leaveGroup() {
    setMenuVisible(false)
    Alert.alert(
      'Leave Group',
      `Are you sure you want to leave "${group?.name}"? Your expense history will remain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => runLeaveGroup(),
        },
      ]
    )
  }

  async function runLeaveGroup() {
    setActionLoading(true)
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', currentUser.id)

    setActionLoading(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      router.back()
    }
  }

  // ── Delete Group ─────────────────────────────────────────────────────────────
  function deleteGroup() {
    setMenuVisible(false)
    Alert.alert(
      'Delete Group',
      `Permanently delete "${group?.name}" and all its expenses? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => runDeleteGroup(),
        },
      ]
    )
  }

  async function runDeleteGroup() {
    setActionLoading(true)

    // 1. Get all bill IDs in this group
    const { data: groupBills, error: billFetchErr } = await supabase
      .from('bills').select('id').eq('group_id', groupId)

    if (billFetchErr) {
      setActionLoading(false)
      return Alert.alert('Error', 'Could not fetch bills: ' + billFetchErr.message)
    }

    const billIds = (groupBills || []).map((b: any) => b.id)

    if (billIds.length > 0) {
      // 2. Delete bill_splits
      const { error: e1 } = await supabase
        .from('bill_splits').delete().in('bill_id', billIds)
      if (e1) console.log('bill_splits delete error (ok to ignore):', e1.message)

      // 3. Delete bill_items
      const { error: e2 } = await supabase
        .from('bill_items').delete().in('bill_id', billIds)
      if (e2) console.log('bill_items delete error (ok to ignore):', e2.message)

      // 4. Delete bills
      const { error: e3 } = await supabase
        .from('bills').delete().in('id', billIds)
      if (e3) {
        setActionLoading(false)
        return Alert.alert('Error', 'Could not delete bills: ' + e3.message)
      }
    }

    // 5. Delete settlements
    const { error: e4 } = await supabase
      .from('settlements').delete().eq('group_id', groupId)
    if (e4) console.log('settlements delete error (ok to ignore):', e4.message)

    // 6. Delete group members
    const { error: e5 } = await supabase
      .from('group_members').delete().eq('group_id', groupId)
    if (e5) {
      setActionLoading(false)
      return Alert.alert('Error', 'Could not remove members: ' + e5.message)
    }

    // 7. Delete the group itself
    const { error: e6 } = await supabase
      .from('groups').delete().eq('id', groupId)
    if (e6) {
      setActionLoading(false)
      return Alert.alert('Error', 'Could not delete group: ' + e6.message)
    }

    // Navigate back to groups list
    setActionLoading(false)
    router.back()
  }

  const isCreator = group?.created_by === currentUser?.id

  if (loading || actionLoading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
      {actionLoading && <Text style={styles.actionLoadingText}>Processing...</Text>}
    </View>
  )

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.groupName} numberOfLines={1}>{group?.name}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setInviteVisible(true)} style={{ marginRight: 14 }}>
            <Ionicons name="person-add" size={22} color="#1DB954" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuVisible(true)}>
            <Ionicons name="ellipsis-vertical" size={22} color="#666" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Balance Card */}
      <View style={[styles.balanceCard, { backgroundColor: myBalance >= 0 ? '#e8f9ee' : '#fdecea' }]}>
        <Text style={styles.balanceLabel}>{myBalance >= 0 ? 'You are owed' : 'You owe'}</Text>
        <Text style={[styles.balanceAmount, { color: myBalance >= 0 ? '#1DB954' : '#e53935' }]}>
          ${Math.abs(myBalance).toFixed(2)}
        </Text>
        <Text style={styles.memberCount}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>
      </View>

      {/* Action Buttons */}
      <TouchableOpacity
        style={styles.addExpenseBtn}
        onPress={() => router.push(
          `/(tabs)/group/add-expense?id=${groupId}&members=${encodeURIComponent(JSON.stringify(members.map(m => m.profiles)))}`
        )}
      >
        <Ionicons name="add-circle" size={20} color="#fff" />
        <Text style={styles.addExpenseBtnText}>Add Expense</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settleUpBtn}
        onPress={() => router.push(`/(tabs)/group/settle?id=${groupId}`)}
      >
        <Ionicons name="swap-horizontal" size={20} color="#1DB954" />
        <Text style={styles.settleUpBtnText}>Settle Up</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Expenses</Text>

      {bills.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={48} color="#ddd" />
          <Text style={styles.emptyText}>No expenses yet</Text>
          <Text style={styles.emptySubtext}>Add your first expense above</Text>
        </View>
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.billCard}
              onPress={() => router.push(
                `/(tabs)/group/bill-detail?billId=${item.id}&groupId=${groupId}`
              )}
              activeOpacity={0.75}
            >
              <View style={styles.billIcon}>
                <Ionicons name="receipt" size={20} color="#1DB954" />
              </View>
              <View style={styles.billInfo}>
                <Text style={styles.billDesc}>{item.description || 'Expense'}</Text>
                <Text style={styles.billDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
              </View>
              <View style={styles.billRight}>
                <Text style={styles.billAmount}>${item.total_amount.toFixed(2)}</Text>
                <View style={styles.compassBtn}>
                  <Text style={styles.compassBtnText}>View →</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}

      {/* ── Invite Modal ────────────────────────────────────────────────────── */}
      <Modal visible={inviteVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Member</Text>
              <TouchableOpacity onPress={() => { setInviteVisible(false); setInviteEmail('') }}>
                <Ionicons name="close" size={24} color="#999" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Enter their email. They must have a SplitSmart account.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="friend@email.com"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.modalBtn, (!inviteEmail.trim() || inviting) && styles.modalBtnDisabled]}
              onPress={inviteMember}
              disabled={inviting || !inviteEmail.trim()}
            >
              {inviting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.modalBtnText}>Add to Group</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Group Actions Menu ───────────────────────────────────────────────── */}
      <Modal visible={menuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuSheet}>
            <View style={styles.menuHandle} />

            <Text style={styles.menuGroupName}>{group?.name}</Text>

            {/* Leave Group — available to everyone */}
            <TouchableOpacity style={styles.menuItem} onPress={leaveGroup}>
              <View style={[styles.menuIconBox, { backgroundColor: '#fff3e0' }]}>
                <Ionicons name="exit-outline" size={20} color="#f57c00" />
              </View>
              <View style={styles.menuItemText}>
                <Text style={styles.menuItemTitle}>Leave Group</Text>
                <Text style={styles.menuItemSub}>Remove yourself from this group</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#ccc" />
            </TouchableOpacity>

            {/* Delete Group — only for the creator */}
            {isCreator && (
              <TouchableOpacity style={styles.menuItem} onPress={deleteGroup}>
                <View style={[styles.menuIconBox, { backgroundColor: '#fdecea' }]}>
                  <Ionicons name="trash-outline" size={20} color="#e53935" />
                </View>
                <View style={styles.menuItemText}>
                  <Text style={[styles.menuItemTitle, { color: '#e53935' }]}>Delete Group</Text>
                  <Text style={styles.menuItemSub}>Permanently delete all expenses</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#ccc" />
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.menuCancelBtn} onPress={() => setMenuVisible(false)}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  actionLoadingText: { fontSize: 14, color: '#999' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 20, paddingTop: 60,
  },
  groupName: { flex: 1, fontSize: 20, fontWeight: 'bold', color: '#1a1a1a', marginHorizontal: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },

  balanceCard: { margin: 16, padding: 20, borderRadius: 16, alignItems: 'center' },
  balanceLabel: { fontSize: 15, color: '#555' },
  balanceAmount: { fontSize: 36, fontWeight: 'bold', marginVertical: 4 },
  memberCount: { fontSize: 13, color: '#999' },

  addExpenseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1DB954', margin: 16, marginBottom: 8,
    padding: 14, borderRadius: 12, gap: 8,
  },
  addExpenseBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  settleUpBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#1DB954', margin: 16,
    marginTop: 0, padding: 14, borderRadius: 12, gap: 8,
  },
  settleUpBtnText: { color: '#1DB954', fontSize: 16, fontWeight: '600' },

  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', paddingHorizontal: 16, marginBottom: 8 },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { fontSize: 17, color: '#333', fontWeight: '500' },
  emptySubtext: { fontSize: 14, color: '#999' },

  billCard: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    marginHorizontal: 16, marginBottom: 8, backgroundColor: '#f9f9f9', borderRadius: 12,
  },
  billIcon: { width: 40, height: 40, backgroundColor: '#e8f9ee', borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  billInfo: { flex: 1, marginLeft: 12 },
  billDesc: { fontSize: 16, fontWeight: '500', color: '#1a1a1a' },
  billDate: { fontSize: 13, color: '#999', marginTop: 2 },
  billRight: { alignItems: 'flex-end', gap: 6 },
  billAmount: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  compassBtn: { backgroundColor: '#e8f9ee', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  compassBtnText: { fontSize: 11, color: '#1DB954', fontWeight: '600' },

  // Invite modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  modalSub: { fontSize: 14, color: '#999', marginBottom: 20 },
  modalInput: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 12,
    padding: 16, fontSize: 16, marginBottom: 16,
  },
  modalBtn: { backgroundColor: '#1DB954', padding: 16, borderRadius: 12, alignItems: 'center' },
  modalBtnDisabled: { backgroundColor: '#ccc' },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Group actions menu
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  menuSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 48,
  },
  menuHandle: {
    width: 40, height: 4, backgroundColor: '#e0e0e0',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  menuGroupName: {
    fontSize: 13, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 16, paddingHorizontal: 4,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, gap: 14,
    borderTopWidth: 1, borderTopColor: '#f5f5f5',
  },
  menuIconBox: {
    width: 40, height: 40, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  menuItemText: { flex: 1 },
  menuItemTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  menuItemSub: { fontSize: 13, color: '#999', marginTop: 1 },
  menuCancelBtn: {
    marginTop: 16, padding: 16,
    backgroundColor: '#f5f5f5', borderRadius: 14, alignItems: 'center',
  },
  menuCancelText: { fontSize: 16, fontWeight: '600', color: '#555' },
})
