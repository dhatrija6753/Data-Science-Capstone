import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { compareCartAcrossStores, ALL_STORES } from '../../../lib/stores'
import { categorizeItems } from '../../../lib/categorizer'

export default function BillDetailScreen() {
  const { billId, groupId } = useLocalSearchParams()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [bill, setBill] = useState<any>(null)
  const [splits, setSplits] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])   // group members for "paid by" name

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [editTotal, setEditTotal] = useState('')
  const [editPaidBy, setEditPaidBy] = useState('')
  const [editSplits, setEditSplits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Recommendation state
  const [recLoading, setRecLoading] = useState(false)
  const [recs, setRecs] = useState<any[] | null>(null)
  const [itemRecs, setItemRecs] = useState<any[]>([])
  const [totalPaid, setTotalPaid] = useState(0)

  useFocusEffect(useCallback(() => {
    loadAll()
  }, [billId]))

  async function loadAll() {
    if (!billId) return
    setLoading(true)
    setRecs(null)
    setItemRecs([])
    try {
      // Bill
      const { data: billData } = await supabase
        .from('bills')
        .select('*')
        .eq('id', billId)
        .single()
      setBill(billData)
      setEditDesc(billData?.description || '')
      setEditTotal(billData?.total_amount?.toString() || '')
      setEditPaidBy(billData?.paid_by || '')
      setTotalPaid(billData?.total_amount || 0)

      // Splits with profile names
      const { data: splitsData } = await supabase
        .from('bill_splits')
        .select('*, profiles(id, full_name)')
        .eq('bill_id', billId)
      setSplits(splitsData || [])
      // Init editable split amounts from current splits
      const initSplits: Record<string, string> = {}
      splitsData?.forEach((s: any) => { initSplits[s.user_id] = s.amount_owed?.toString() || '0' })
      setEditSplits(initSplits)

      // Items
      const { data: itemsData } = await supabase
        .from('bill_items')
        .select('*')
        .eq('bill_id', billId)
      setItems(itemsData || [])

      // Group members (for "paid by" label + edit chips)
      if (groupId) {
        const { data: membersData } = await supabase
          .from('group_members')
          .select('*, profiles(id, full_name)')
          .eq('group_id', groupId)
        setMembers(membersData || [])
      }

      // Auto-run price recommendations if items exist
      if (itemsData && itemsData.length > 0) {
        runRecommendations(itemsData, billData?.total_amount || 0, billData?.store_name)
      }
    } catch (e) {
      console.log('loadAll error:', e)
    }
    setLoading(false)
  }

  async function runRecommendations(billItems: any[], paid: number, storeName?: string | null) {
    setRecLoading(true)
    try {
      const itemNames = billItems.map((i: any) => i.name)
      const categories = await categorizeItems(itemNames)
      const categorized = billItems.map((i: any) => ({
        name: i.name,
        total_price: i.total_price,
        category: categories[i.name] || 'other',
      }))
      const { itemResults, storeRanking } = await compareCartAcrossStores(
        categorized,
        storeName || null,
        ALL_STORES.map(s => s.id)
      )
      setItemRecs(itemResults || [])
      setRecs(storeRanking || [])
    } catch (e) {
      console.log('rec error:', e)
    }
    setRecLoading(false)
  }

  async function saveEdit() {
    const newTotal = parseFloat(editTotal)
    if (!editDesc.trim()) return Alert.alert('Error', 'Description cannot be empty')
    if (isNaN(newTotal) || newTotal <= 0) return Alert.alert('Error', 'Enter a valid total')
    if (!editPaidBy) return Alert.alert('Error', 'Select who paid')

    // Validate splits sum
    const splitSum = Object.values(editSplits).reduce((s, v) => s + (parseFloat(v) || 0), 0)
    const splitRemaining = parseFloat((newTotal - splitSum).toFixed(2))
    if (Math.abs(splitRemaining) > 0.01) {
      return Alert.alert(
        'Splits don\'t add up',
        `Total is $${newTotal.toFixed(2)} but splits sum to $${splitSum.toFixed(2)}.\n${
          splitRemaining > 0
            ? `$${splitRemaining.toFixed(2)} still unassigned.`
            : `Over by $${Math.abs(splitRemaining).toFixed(2)}.`
        }`
      )
    }

    setSaving(true)

    const { error } = await supabase
      .from('bills')
      .update({
        description: editDesc.trim(),
        total_amount: newTotal,
        paid_by: editPaidBy,
      })
      .eq('id', billId)

    if (error) {
      Alert.alert('Error', error.message)
      setSaving(false)
      return
    }

    // Save each person's edited split amount
    await Promise.all(
      Object.entries(editSplits).map(([userId, amt]) =>
        supabase.from('bill_splits')
          .update({ amount_owed: parseFloat(parseFloat(amt).toFixed(2)) || 0 })
          .eq('bill_id', billId)
          .eq('user_id', userId)
      )
    )

    setSaving(false)
    setEditing(false)
    await loadAll()
  }

  function getPaidByName() {
    if (!bill?.paid_by) return 'Unknown'
    const member = members.find(m => m.profiles?.id === bill.paid_by)
    return member?.profiles?.full_name || 'Unknown'
  }

  const bestStore = recs && recs.length > 0 ? recs[0] : null
  const savings = bestStore && totalPaid > 0
    ? parseFloat((totalPaid - bestStore.totalCost).toFixed(2))
    : 0

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
    </View>
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {bill?.description || 'Expense'}
        </Text>
        {!editing ? (
          <TouchableOpacity onPress={() => setEditing(true)} style={styles.editBtn}>
            <Ionicons name="pencil" size={20} color="#1DB954" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setEditing(false)} style={styles.editBtn}>
            <Ionicons name="close" size={22} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── BILL INFO / EDIT ── */}
      {editing ? (
        <View style={styles.editCard}>
          <Text style={styles.sectionLabel}>Edit Expense</Text>

          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={styles.input}
            value={editDesc}
            onChangeText={setEditDesc}
            placeholder="Expense description"
          />

          <Text style={styles.fieldLabel}>Total Amount</Text>
          <View style={styles.amountRow}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={editTotal}
              onChangeText={setEditTotal}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          <Text style={styles.fieldLabel}>Who Paid?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            {members.map(m => (
              <TouchableOpacity
                key={m.profiles.id}
                style={[styles.paidChip, editPaidBy === m.profiles.id && styles.paidChipActive]}
                onPress={() => setEditPaidBy(m.profiles.id)}
              >
                <View style={[styles.chipAvatar, editPaidBy === m.profiles.id && styles.chipAvatarActive]}>
                  <Text style={styles.chipAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text>
                </View>
                <Text style={[styles.chipName, editPaidBy === m.profiles.id && { color: '#1DB954' }]}>
                  {m.profiles.full_name?.split(' ')[0]}
                </Text>
                {editPaidBy === m.profiles.id && (
                  <Ionicons name="checkmark-circle" size={16} color="#1DB954" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Per-person split editor ── */}
          <Text style={styles.fieldLabel}>Edit Splits</Text>
          {(() => {
            const splitSum = Object.values(editSplits).reduce((s, v) => s + (parseFloat(v) || 0), 0)
            const newTotal = parseFloat(editTotal) || 0
            const remaining = parseFloat((newTotal - splitSum).toFixed(2))
            const ok = Math.abs(remaining) < 0.01
            const remColor = ok ? '#1DB954' : remaining > 0 ? '#f57c00' : '#e53935'

            return (
              <>
                {/* Quick-fill buttons */}
                <View style={styles.splitQuickRow}>
                  <TouchableOpacity
                    style={styles.quickBtn}
                    onPress={() => {
                      // Split equally among all split members
                      const n = splits.length
                      if (n === 0) return
                      const each = (newTotal / n).toFixed(2)
                      const newSplits: Record<string, string> = {}
                      splits.forEach(s => { newSplits[s.user_id] = each })
                      setEditSplits(newSplits)
                    }}
                  >
                    <Text style={styles.quickBtnText}>⚖️ Split Equally</Text>
                  </TouchableOpacity>
                </View>

                {/* Remaining indicator */}
                {newTotal > 0 && (
                  <View style={[styles.remBar, { backgroundColor: ok ? '#e8f9ee' : '#fff3e0' }]}>
                    <Ionicons name={ok ? 'checkmark-circle' : 'information-circle'} size={15} color={remColor} />
                    <Text style={[styles.remText, { color: remColor }]}>
                      {ok
                        ? 'Splits balance ✓'
                        : remaining > 0
                          ? `$${remaining.toFixed(2)} left to assign`
                          : `Over by $${Math.abs(remaining).toFixed(2)}`}
                    </Text>
                  </View>
                )}

                {/* Per-person rows */}
                {splits.map(split => (
                  <View key={split.user_id} style={styles.splitEditRow}>
                    <View style={styles.splitAvatar}>
                      <Text style={styles.splitAvatarText}>
                        {split.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                      </Text>
                    </View>
                    <Text style={styles.splitEditName} numberOfLines={1}>
                      {split.profiles?.full_name || 'Unknown'}
                    </Text>
                    <View style={styles.splitInputBox}>
                      <Text style={styles.dollar}>$</Text>
                      <TextInput
                        style={styles.splitInput}
                        value={editSplits[split.user_id] || ''}
                        onChangeText={v => setEditSplits(prev => ({ ...prev, [split.user_id]: v }))}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                      />
                    </View>
                  </View>
                ))}
              </>
            )
          })()}

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={saveEdit}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="receipt-outline" size={18} color="#1DB954" />
            <Text style={styles.infoLabel}>Description</Text>
            <Text style={styles.infoValue}>{bill?.description || '—'}</Text>
          </View>
          {bill?.store_name ? (
            <View style={styles.infoRow}>
              <Ionicons name="storefront-outline" size={18} color="#1DB954" />
              <Text style={styles.infoLabel}>Store</Text>
              <Text style={styles.infoValue}>{bill.store_name}</Text>
            </View>
          ) : null}
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={18} color="#1DB954" />
            <Text style={styles.infoLabel}>Date</Text>
            <Text style={styles.infoValue}>
              {bill?.bill_date
                ? new Date(bill.bill_date).toLocaleDateString()
                : new Date(bill?.created_at).toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={18} color="#1DB954" />
            <Text style={styles.infoLabel}>Paid by</Text>
            <Text style={styles.infoValue}>{getPaidByName()}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Ionicons name="cash-outline" size={18} color="#1DB954" />
            <Text style={styles.infoLabel}>Total</Text>
            <Text style={[styles.infoValue, { fontWeight: '800', color: '#1a1a1a', fontSize: 18 }]}>
              ${bill?.total_amount?.toFixed(2)}
            </Text>
          </View>
        </View>
      )}

      {/* ── SPLITS ── */}
      <Text style={styles.sectionTitle}>💸 Splits</Text>
      {splits.length === 0 ? (
        <Text style={styles.emptyText}>No splits recorded</Text>
      ) : (
        <View style={styles.splitsCard}>
          {splits.map((split, idx) => {
            const isLast = idx === splits.length - 1
            const isPayer = split.user_id === bill?.paid_by
            return (
              <View key={split.user_id} style={[styles.splitRow, isLast && { borderBottomWidth: 0 }]}>
                <View style={styles.splitAvatar}>
                  <Text style={styles.splitAvatarText}>
                    {split.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.splitName}>{split.profiles?.full_name || 'Unknown'}</Text>
                  {isPayer && <Text style={styles.payerBadge}>paid</Text>}
                </View>
                <Text style={[styles.splitAmt, isPayer && { color: '#1DB954' }]}>
                  {isPayer ? '+' : '-'}${split.amount_owed?.toFixed(2)}
                </Text>
              </View>
            )
          })}
        </View>
      )}

      {/* ── ITEMS ── */}
      {items.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>🧾 Items</Text>
          <View style={styles.itemsCard}>
            {items.map((item, idx) => (
              <View key={idx} style={[styles.itemRow, idx === items.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.quantity > 1 && (
                    <Text style={styles.itemQty}>× {item.quantity}</Text>
                  )}
                </View>
                <Text style={styles.itemPrice}>${item.total_price?.toFixed(2)}</Text>
              </View>
            ))}
            <View style={styles.itemsTotalRow}>
              <Text style={styles.itemsTotalLabel}>Total</Text>
              <Text style={styles.itemsTotalAmt}>${bill?.total_amount?.toFixed(2)}</Text>
            </View>
          </View>
        </>
      )}

      {/* ── SMART RECOMMENDATIONS ── */}
      <Text style={styles.sectionTitle}>💡 Smart Recommendations</Text>

      {items.length === 0 ? (
        <View style={styles.recEmpty}>
          <Ionicons name="bulb-outline" size={32} color="#ccc" />
          <Text style={styles.recEmptyText}>No items to compare</Text>
          <Text style={styles.recEmptySub}>
            Recommendations appear when your bill has scanned items
          </Text>
        </View>
      ) : recLoading ? (
        <View style={styles.recLoading}>
          <ActivityIndicator color="#1DB954" />
          <Text style={styles.recLoadingText}>Comparing prices across DMV stores...</Text>
        </View>
      ) : recs && recs.length > 0 ? (
        <>
          {/* Savings hero */}
          {savings > 0.5 ? (
            <View style={styles.savingsHero}>
              <Text style={styles.savingsEmoji}>🎉</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.savingsTitle}>
                  Save ${savings.toFixed(2)} at {bestStore?.storeName}
                </Text>
                <Text style={styles.savingsSub}>
                  Cheapest store for your cart
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.savingsHero, { backgroundColor: '#f0fdf4' }]}>
              <Text style={styles.savingsEmoji}>✅</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.savingsTitle, { color: '#1DB954' }]}>
                  Great price! You paid near the best rate.
                </Text>
              </View>
            </View>
          )}

          {/* Store ranking */}
          <View style={styles.storeRankCard}>
            <Text style={styles.storeRankTitle}>Store Rankings for This Cart</Text>
            {recs.slice(0, 5).map((store, idx) => {
              const diff = parseFloat((totalPaid - store.totalCost).toFixed(2))
              const isBest = idx === 0
              return (
                <View key={store.storeId} style={[styles.storeRow, isBest && styles.storeRowBest]}>
                  <Text style={styles.storeRank}>#{idx + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.storeName, isBest && { color: '#1DB954' }]}>
                      {store.storeName}
                      {isBest ? ' 🏆' : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.storeEstimate}>${store.totalCost.toFixed(2)}</Text>
                    {diff > 0 && (
                      <Text style={styles.storeSave}>save ${diff.toFixed(2)}</Text>
                    )}
                    {diff < 0 && (
                      <Text style={styles.storeMore}>+${Math.abs(diff).toFixed(2)} more</Text>
                    )}
                  </View>
                </View>
              )
            })}
          </View>

          {/* Per-item cheapest */}
          {itemRecs.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Per-item Best Prices</Text>
              <View style={styles.itemsCard}>
                {itemRecs.map((ir, idx) => (
                  <View key={idx} style={[styles.itemRow, idx === itemRecs.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{ir.itemName}</Text>
                      <Text style={styles.itemQty}>Best: {ALL_STORES.find(s => s.id === ir.cheapestStore)?.name || ir.cheapestStore}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.itemPrice}>${ir.cheapestPrice?.toFixed(2)}</Text>
                      {ir.pricePaid > ir.cheapestPrice && (
                        <Text style={styles.storeSave}>
                          save ${(ir.pricePaid - ir.cheapestPrice).toFixed(2)}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      ) : (
        <View style={styles.recEmpty}>
          <Ionicons name="bulb-outline" size={32} color="#ccc" />
          <Text style={styles.recEmptyText}>No comparison data available</Text>
        </View>
      )}

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 16, gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: '#1a1a1a' },
  editBtn: { padding: 8 },

  // Info card
  infoCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#ebebeb',
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f2f2f2',
  },
  infoLabel: { fontSize: 14, color: '#888', width: 80 },
  infoValue: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '500', textAlign: 'right' },

  // Section titles
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 10, marginTop: 4 },
  sectionLabel: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 14 },

  // Splits card
  splitsCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#ebebeb',
  },
  splitRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  splitAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  splitAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  splitName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  payerBadge: { fontSize: 11, color: '#1DB954', fontWeight: '600', marginTop: 2 },
  splitAmt: { fontSize: 17, fontWeight: '800', color: '#e53935' },

  // Items card
  itemsCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#ebebeb',
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  itemName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  itemQty: { fontSize: 12, color: '#999', marginTop: 2 },
  itemPrice: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  itemsTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 10, marginTop: 4,
    borderTopWidth: 1.5, borderTopColor: '#1DB954',
  },
  itemsTotalLabel: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  itemsTotalAmt: { fontSize: 16, fontWeight: '800', color: '#1DB954' },

  // Edit card
  editCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 20,
    borderWidth: 1.5, borderColor: '#1DB954',
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 12, padding: 14, fontSize: 15,
    backgroundColor: '#fafafa', marginBottom: 4,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dollar: { fontSize: 18, color: '#999', fontWeight: '600', paddingBottom: 4 },

  // Split editor
  splitQuickRow: { flexDirection: 'row', marginBottom: 10 },
  quickBtn: {
    backgroundColor: '#e8f9ee', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1DB954',
  },
  quickBtnText: { fontSize: 13, color: '#1DB954', fontWeight: '700' },
  remBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, borderRadius: 10, marginBottom: 12,
  },
  remText: { fontSize: 13, fontWeight: '600', flex: 1 },
  splitEditRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginBottom: 10,
    backgroundColor: '#f5f5f5', borderRadius: 12, padding: 10,
  },
  splitEditName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
  splitInputBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, paddingHorizontal: 8,
    backgroundColor: '#fff', width: 100,
  },
  splitInput: { flex: 1, padding: 10, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  paidChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 30, paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: '#e0e0e0',
    backgroundColor: '#f9f9f9', marginRight: 8,
  },
  paidChipActive: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  chipAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#ccc', justifyContent: 'center', alignItems: 'center',
  },
  chipAvatarActive: { backgroundColor: '#1DB954' },
  chipAvatarText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  chipName: { fontSize: 14, fontWeight: '600', color: '#666' },
  editNote: { fontSize: 12, color: '#aaa', marginBottom: 14, marginTop: 4 },
  saveBtn: {
    backgroundColor: '#1DB954', borderRadius: 14,
    padding: 16, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Recommendations
  recEmpty: {
    alignItems: 'center', padding: 32,
    backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: '#ebebeb', marginBottom: 20,
  },
  recEmptyText: { fontSize: 15, fontWeight: '600', color: '#ccc', marginTop: 10 },
  recEmptySub: { fontSize: 13, color: '#ccc', textAlign: 'center', marginTop: 4 },
  recLoading: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 16,
    padding: 20, marginBottom: 20,
    borderWidth: 1, borderColor: '#ebebeb',
  },
  recLoadingText: { fontSize: 14, color: '#888' },
  savingsHero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff9f0', borderRadius: 16,
    padding: 16, marginBottom: 12,
    borderWidth: 1.5, borderColor: '#f57c00',
  },
  savingsEmoji: { fontSize: 32 },
  savingsTitle: { fontSize: 16, fontWeight: '700', color: '#e65100' },
  savingsSub: { fontSize: 13, color: '#999', marginTop: 2 },
  storeRankCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#ebebeb',
  },
  storeRankTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  storeRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  storeRowBest: { backgroundColor: '#f0fdf4', marginHorizontal: -16, paddingHorizontal: 16 },
  storeRank: { width: 24, fontSize: 13, fontWeight: '700', color: '#999' },
  storeName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  storeEstimate: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  storeSave: { fontSize: 12, color: '#1DB954', fontWeight: '600' },
  storeMore: { fontSize: 12, color: '#e53935', fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center', padding: 16 },
})
