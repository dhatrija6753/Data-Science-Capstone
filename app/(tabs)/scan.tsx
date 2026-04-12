import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView,
  TextInput, Modal, FlatList
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { extractReceiptFromImage, ExtractedItem } from '../../lib/gemini'
import { supabase } from '../../lib/supabase'

type Step = 'capture' | 'review' | 'assign' | 'manual' | 'done'
type SplitMode = 'equal' | 'exact' | 'percentage' | 'shares' | 'items'

const SPLIT_MODES: { key: SplitMode; emoji: string; label: string }[] = [
  { key: 'equal',      emoji: '⚖️', label: 'Equal'   },
  { key: 'exact',      emoji: '✏️', label: 'Exact $'  },
  { key: 'percentage', emoji: '%',  label: 'Percent'  },
  { key: 'shares',     emoji: '#',  label: 'Shares'   },
  { key: 'items',      emoji: '🧾', label: 'By Items' },
]

export default function ScanScreen() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('capture')
  const [scanning, setScanning] = useState(false)
  const [items, setItems] = useState<ExtractedItem[]>([])
  const [storeName, setStoreName] = useState('')
  const [total, setTotal] = useState(0)
  const [groups, setGroups] = useState<any[]>([])
  const [selectedGroup, setSelectedGroup] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [paidBy, setPaidBy] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [groupModalVisible, setGroupModalVisible] = useState(false)
  const [savedBillId, setSavedBillId] = useState<string>('')

  // Split mode
  const [splitMode, setSplitMode] = useState<SplitMode>('items')
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({})
  const [percentages, setPercentages] = useState<Record<string, string>>({})
  const [sharesCount, setSharesCount] = useState<Record<string, string>>({})
  const [includedMembers, setIncludedMembers] = useState<Set<string>>(new Set())

  // Item-based split: maps item index → userId or 'split' (equal)
  const [itemAssignments, setItemAssignments] = useState<Record<number, string>>({})

  function assignItem(index: number, userId: string) {
    setItemAssignments(prev => ({ ...prev, [index]: userId }))
  }

  function initAssignments() {
    const init: Record<number, string> = {}
    items.forEach((_, i) => { init[i] = 'split' })
    setItemAssignments(init)
    const exact: Record<string, string> = {}
    const pct: Record<string, string> = {}
    const shr: Record<string, string> = {}
    const inc = new Set<string>()
    const n = members.length || 1
    members.forEach((m: any) => {
      exact[m.profiles.id] = ''
      pct[m.profiles.id] = (100 / n).toFixed(1)
      shr[m.profiles.id] = '1'
      inc.add(m.profiles.id)
    })
    setExactAmounts(exact)
    setPercentages(pct)
    setSharesCount(shr)
    setIncludedMembers(inc)
  }

  function toggleIncluded(id: string) {
    setIncludedMembers(prev => {
      const next = new Set(prev)
      if (next.has(id)) { if (next.size > 1) next.delete(id) }
      else next.add(id)
      return next
    })
  }

  function splitPctEqually() {
    const each = (100 / (members.length || 1)).toFixed(1)
    const pct: Record<string, string> = {}
    members.forEach((m: any) => { pct[m.profiles.id] = each })
    setPercentages(pct)
  }

  // Per-person totals — all 5 split modes
  function calcPerPerson(): Record<string, number> {
    const totals: Record<string, number> = {}
    members.forEach((m: any) => { totals[m.profiles.id] = 0 })
    if (members.length === 0) return totals

    if (splitMode === 'equal') {
      const inc = members.filter((m: any) => includedMembers.has(m.profiles.id))
      if (inc.length > 0) {
        const each = finalTotal / inc.length
        inc.forEach((m: any) => { totals[m.profiles.id] = each })
      }
      return totals
    }

    if (splitMode === 'exact') {
      members.forEach((m: any) => {
        totals[m.profiles.id] = parseFloat(exactAmounts[m.profiles.id]) || 0
      })
      return totals
    }

    if (splitMode === 'percentage') {
      members.forEach((m: any) => {
        totals[m.profiles.id] = finalTotal * (parseFloat(percentages[m.profiles.id]) || 0) / 100
      })
      return totals
    }

    if (splitMode === 'shares') {
      const totalSh = members.reduce((s: number, m: any) => s + (parseInt(sharesCount[m.profiles.id]) || 0), 0)
      if (totalSh > 0) {
        members.forEach((m: any) => {
          totals[m.profiles.id] = finalTotal * (parseInt(sharesCount[m.profiles.id]) || 0) / totalSh
        })
      }
      return totals
    }

    // items mode
    const tax = Math.max(0, finalTotal - itemsSubtotal)
    items.forEach((item, i) => {
      const assignment = itemAssignments[i] ?? 'split'
      if (assignment === 'split') {
        members.forEach((m: any) => { totals[m.profiles.id] += item.total_price / members.length })
      } else if (totals[assignment] !== undefined) {
        totals[assignment] += item.total_price
      }
    })
    if (tax > 0) {
      members.forEach((m: any) => { totals[m.profiles.id] += tax / members.length })
    }
    return totals
  }

  // Auto-fill exact amounts from item assignments in exact mode
  useEffect(() => {
    if (splitMode !== 'exact' || members.length === 0 || items.length === 0) return
    const newAmts: Record<string, string> = {}
    members.forEach((m: any) => { newAmts[m.profiles.id] = '0.00' })
    const tax = Math.max(0, finalTotal - itemsSubtotal)
    items.forEach((item, i) => {
      const assignment = itemAssignments[i] ?? 'split'
      if (assignment === 'split') {
        members.forEach((m: any) => {
          newAmts[m.profiles.id] = (
            (parseFloat(newAmts[m.profiles.id]) || 0) + item.total_price / members.length
          ).toFixed(2)
        })
      } else if (newAmts[assignment] !== undefined) {
        newAmts[assignment] = (
          (parseFloat(newAmts[assignment]) || 0) + item.total_price
        ).toFixed(2)
      }
    })
    if (tax > 0) {
      members.forEach((m: any) => {
        newAmts[m.profiles.id] = (
          (parseFloat(newAmts[m.profiles.id]) || 0) + tax / members.length
        ).toFixed(2)
      })
    }
    setExactAmounts(newAmts)
  }, [itemAssignments, splitMode])

  // Manual entry state
  const [manualDesc, setManualDesc] = useState('')
  const [manualStore, setManualStore] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualItems, setManualItems] = useState<{ name: string; price: string }[]>([
    { name: '', price: '' }
  ])

  async function pickImage(useCamera: boolean) {
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert('Permission needed', `Please allow ${useCamera ? 'camera' : 'photo library'} access`)
      return
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true })

    if (!result.canceled && result.assets[0]) {
      await scanReceipt(result.assets[0])
    }
  }

  async function scanReceipt(asset: any) {
    setScanning(true)
    try {
      let base64 = asset.base64
      if (!base64) {
        base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64
        })
      }
      const receipt = await extractReceiptFromImage(base64)
      setItems(receipt.items || [])
      setStoreName(receipt.store_name || '')
      setTotal(receipt.total || 0)
      await loadGroups()
      setStep('review')
    } catch (error: any) {
      Alert.alert('Scan failed', 'Could not read the receipt. Try a clearer photo.')
      console.log('Scan error:', error)
    }
    setScanning(false)
  }

  async function loadGroups() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name)')
      .eq('user_id', user.id)
    if (error) { console.log('loadGroups error:', error.message); return }
    const parsed = (data || []).map((d: any) => d.groups).filter(Boolean)
    setGroups(parsed)
  }

  async function selectGroup(group: any) {
    setSelectedGroup(group)
    setGroupModalVisible(false)
    const { data } = await supabase
      .from('group_members')
      .select('*, profiles(id, full_name)')
      .eq('group_id', group.id)
    setMembers(data || [])
  }

  function updateItem(index: number, field: keyof ExtractedItem, value: string) {
    const updated = [...items]
    if (field === 'name') updated[index].name = value
    else updated[index] = { ...updated[index], [field]: parseFloat(value) || 0 }
    setItems(updated)
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index))
  }

  function addEmptyItem() {
    setItems([...items, { name: 'New Item', quantity: 1, unit_price: 0, total_price: 0 }])
  }

  const itemsSubtotal = items.reduce((s, i) => s + i.total_price, 0)
  const finalTotal = total > 0 ? total : itemsSubtotal

  async function saveBill() {
    if (!selectedGroup) return Alert.alert('Error', 'Please select a group')
    if (!paidBy) return Alert.alert('Error', 'Please select who paid')
    if (members.length === 0) return Alert.alert('Error', 'No members in group')

    setSaving(true)

    const { data: bill, error } = await supabase
      .from('bills')
      .insert({
        group_id: selectedGroup.id,
        paid_by: paidBy,
        description: storeName || 'Scanned Receipt',
        total_amount: parseFloat(finalTotal.toFixed(2)),
        split_type: 'equal',
        store_name: storeName,
        bill_date: new Date().toISOString().split('T')[0]
      })
      .select()
      .single()

    if (error) {
      Alert.alert('Error', error.message)
      setSaving(false)
      return
    }

    // Save bill items
    if (items.length > 0) {
      await supabase.from('bill_items').insert(
        items.map(item => ({ ...item, bill_id: bill.id }))
      )
    }

    // Per-person split based on item assignments
    const perPerson = calcPerPerson()
    await supabase.from('bill_splits').insert(
      members.map((m: any) => ({
        bill_id: bill.id,
        user_id: m.profiles.id,
        amount_owed: parseFloat((perPerson[m.profiles.id] || 0).toFixed(2)),
      }))
    )

    setSavedBillId(bill.id)
    setSaving(false)
    setStep('done')
  }

  function resetScanner() {
    setStep('capture')
    setItems([])
    setStoreName('')
    setTotal(0)
    setSelectedGroup(null)
    setPaidBy('')
    setMembers([])
    setSavedBillId('')
    setSplitMode('items')
    setItemAssignments({})
    setExactAmounts({})
    setPercentages({})
    setSharesCount({})
    setIncludedMembers(new Set())
    setManualDesc('')
    setManualStore('')
    setManualAmount('')
    setManualItems([{ name: '', price: '' }])
  }

  async function openManual() {
    await loadGroups()
    setStep('manual')
  }

  function addManualItem() {
    setManualItems([...manualItems, { name: '', price: '' }])
  }

  function updateManualItem(index: number, field: 'name' | 'price', value: string) {
    const updated = [...manualItems]
    updated[index][field] = value
    setManualItems(updated)
  }

  function removeManualItem(index: number) {
    if (manualItems.length === 1) return
    setManualItems(manualItems.filter((_, i) => i !== index))
  }

  // Auto-calculate total from items if no manual override
  const manualItemsTotal = manualItems.reduce((s, i) => s + (parseFloat(i.price) || 0), 0)
  const manualFinalTotal = manualAmount
    ? parseFloat(manualAmount) || 0
    : manualItemsTotal

  async function saveManualBill() {
    const desc = manualDesc.trim() || manualStore.trim() || 'Expense'
    if (!desc) return Alert.alert('Error', 'Please enter a description or store name')
    if (manualFinalTotal <= 0) return Alert.alert('Error', 'Please enter a valid amount')
    if (!selectedGroup) return Alert.alert('Error', 'Please select a group')
    if (!paidBy) return Alert.alert('Error', 'Please select who paid')
    if (members.length === 0) return Alert.alert('Error', 'No members in group')

    setSaving(true)

    const { data: bill, error } = await supabase
      .from('bills')
      .insert({
        group_id: selectedGroup.id,
        paid_by: paidBy,
        description: desc,
        total_amount: parseFloat(manualFinalTotal.toFixed(2)),
        split_type: 'equal',
        store_name: manualStore.trim() || null,
        bill_date: new Date().toISOString().split('T')[0],
      })
      .select()
      .single()

    if (error) { Alert.alert('Error', error.message); setSaving(false); return }

    // Save individual items if entered
    const filledItems = manualItems.filter(i => i.name.trim() && parseFloat(i.price) > 0)
    if (filledItems.length > 0) {
      await supabase.from('bill_items').insert(
        filledItems.map(i => ({
          bill_id: bill.id,
          name: i.name.trim(),
          quantity: 1,
          unit_price: parseFloat(i.price),
          total_price: parseFloat(i.price),
        }))
      )
    }

    // Equal splits
    const splitAmount = parseFloat((manualFinalTotal / members.length).toFixed(2))
    await supabase.from('bill_splits').insert(
      members.map((m: any) => ({
        bill_id: bill.id,
        user_id: m.profiles.id,
        amount_owed: splitAmount,
      }))
    )

    setSavedBillId(bill.id)
    setTotal(manualFinalTotal)
    setSaving(false)
    setStep('done')
  }

  // ── STEP: CAPTURE ──
  if (step === 'capture') return (
    <View style={styles.container}>
      <Text style={styles.title}>Add Expense</Text>
      <Text style={styles.subtitle}>Scan a receipt or enter manually</Text>

      {scanning ? (
        <View style={styles.scanningBox}>
          <ActivityIndicator size="large" color="#1DB954" />
          <Text style={styles.scanningText}>Reading your receipt...</Text>
          <Text style={styles.scanningSubtext}>This takes about 5–10 seconds</Text>
        </View>
      ) : (
        <>
          <View style={styles.optionsBox}>
            <TouchableOpacity style={styles.optionBtn} onPress={() => pickImage(true)}>
              <View style={styles.optionIcon}>
                <Ionicons name="camera" size={36} color="#1DB954" />
              </View>
              <Text style={styles.optionTitle}>Take Photo</Text>
              <Text style={styles.optionSubtitle}>Use your camera</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.optionBtn} onPress={() => pickImage(false)}>
              <View style={styles.optionIcon}>
                <Ionicons name="image" size={36} color="#1DB954" />
              </View>
              <Text style={styles.optionTitle}>Upload Photo</Text>
              <Text style={styles.optionSubtitle}>From your gallery</Text>
            </TouchableOpacity>
          </View>

          {/* Manual entry divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.manualBtn} onPress={openManual}>
            <View style={styles.manualBtnIcon}>
              <Ionicons name="pencil" size={22} color="#1DB954" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.manualBtnTitle}>Enter Manually</Text>
              <Text style={styles.manualBtnSub}>Restaurant, gas, rent, anything</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>
        </>
      )}
    </View>
  )

  // ── STEP: REVIEW ──
  if (step === 'review') return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={styles.title}>Review Items</Text>
      <Text style={styles.subtitle}>Fix any mistakes before splitting</Text>

      {storeName ? (
        <View style={styles.storeRow}>
          <Ionicons name="location" size={16} color="#1DB954" />
          <Text style={styles.storeName}>{storeName}</Text>
        </View>
      ) : null}

      {items.map((item, index) => (
        <View key={index} style={styles.itemRow}>
          <View style={styles.itemMain}>
            <TextInput
              style={styles.itemName}
              value={item.name}
              onChangeText={(v) => updateItem(index, 'name', v)}
              placeholder="Item name"
            />
            <View style={styles.itemPriceRow}>
              <Text style={styles.itemQtyLabel}>qty:</Text>
              <TextInput
                style={styles.itemQtyInput}
                value={item.quantity.toString()}
                onChangeText={(v) => updateItem(index, 'quantity', v)}
                keyboardType="decimal-pad"
              />
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.itemPrice}
                value={item.total_price.toString()}
                onChangeText={(v) => updateItem(index, 'total_price', v)}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <TouchableOpacity onPress={() => removeItem(index)} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={20} color="#ff4444" />
          </TouchableOpacity>
        </View>
      ))}

      {/* Add Missing Item */}
      <TouchableOpacity style={styles.addItemBtn} onPress={addEmptyItem}>
        <Ionicons name="add-circle-outline" size={20} color="#1DB954" />
        <Text style={styles.addItemText}>Add Missing Item</Text>
      </TouchableOpacity>

      {/* Totals */}
      <View style={styles.totalsBox}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Items Subtotal</Text>
          <Text style={styles.totalValue}>${itemsSubtotal.toFixed(2)}</Text>
        </View>
        {total > 0 && total !== itemsSubtotal && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              ${(total - itemsSubtotal).toFixed(2)}
            </Text>
          </View>
        )}
        <View style={[styles.totalRow, styles.grandTotalRow]}>
          <Text style={styles.grandTotalLabel}>Receipt Total</Text>
          <Text style={styles.grandTotalValue}>${finalTotal.toFixed(2)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.nextBtn} onPress={() => { initAssignments(); setStep('assign') }}>
        <Text style={styles.nextBtnText}>Continue to Split →</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.retakeBtn} onPress={resetScanner}>
        <Text style={styles.retakeBtnText}>↩ Retake Photo</Text>
      </TouchableOpacity>
    </ScrollView>
  )

  // ── STEP: ASSIGN ──
  if (step === 'assign') {
    const perPerson = members.length > 0 ? calcPerPerson() : {}
    const tax = Math.max(0, finalTotal - itemsSubtotal)

    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 80 }}>
        <Text style={styles.title}>Split Bill</Text>
        <View style={styles.splitTotalBadge}>
          <Text style={styles.splitTotalText}>Total: ${finalTotal.toFixed(2)}</Text>
        </View>

        {/* Group selector */}
        <Text style={styles.label}>Select Group</Text>
        <TouchableOpacity
          style={styles.selector}
          onPress={() => { loadGroups(); setGroupModalVisible(true) }}
        >
          <Text style={selectedGroup ? styles.selectorText : styles.selectorPlaceholder}>
            {selectedGroup ? selectedGroup.name : 'Choose a group...'}
          </Text>
          <Ionicons name="chevron-down" size={20} color="#999" />
        </TouchableOpacity>

        {/* Who paid */}
        {members.length > 0 && (
          <>
            <Text style={styles.label}>Who paid?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {members.map((m: any) => (
                <TouchableOpacity
                  key={m.profiles.id}
                  style={[styles.paidByChip, paidBy === m.profiles.id && styles.paidByChipSelected]}
                  onPress={() => setPaidBy(m.profiles.id)}
                >
                  <View style={[styles.chipAvatar, paidBy === m.profiles.id && styles.chipAvatarSelected]}>
                    <Text style={styles.chipAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.chipName, paidBy === m.profiles.id && styles.chipNameSelected]}>
                    {m.profiles.full_name?.split(' ')[0]}
                  </Text>
                  {paidBy === m.profiles.id && <Ionicons name="checkmark-circle" size={16} color="#1DB954" />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* ── Split Mode Tabs ── */}
            <Text style={styles.label}>How to split?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {SPLIT_MODES.map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.modeTab, splitMode === tab.key && styles.modeTabActive]}
                  onPress={() => setSplitMode(tab.key)}
                >
                  <Text style={styles.modeTabEmoji}>{tab.emoji}</Text>
                  <Text style={[styles.modeTabText, splitMode === tab.key && styles.modeTabTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* ══ EQUAL mode ══ */}
            {splitMode === 'equal' && (
              <>
                <Text style={styles.assignHint}>Tap to include/exclude from split</Text>
                <View style={styles.memberGrid}>
                  {members.map((m: any) => {
                    const inc = includedMembers.has(m.profiles.id)
                    return (
                      <TouchableOpacity
                        key={m.profiles.id}
                        style={[styles.memberTile, inc && styles.memberTileActive]}
                        onPress={() => toggleIncluded(m.profiles.id)}
                      >
                        <View style={[styles.tileAvatar, inc && styles.tileAvatarActive]}>
                          <Text style={styles.tileAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text>
                        </View>
                        <Text style={[styles.tileName, inc && { color: '#1a1a1a' }]} numberOfLines={1}>
                          {m.profiles.full_name?.split(' ')[0]}
                        </Text>
                        {inc
                          ? <Ionicons name="checkmark-circle" size={15} color="#1DB954" />
                          : <Ionicons name="remove-circle-outline" size={15} color="#ccc" />}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}

            {/* ══ EXACT mode ══ */}
            {splitMode === 'exact' && (() => {
              const exactSum = members.reduce((s: number, m: any) => s + (parseFloat(exactAmounts[m.profiles.id]) || 0), 0)
              const remaining = parseFloat((finalTotal - exactSum).toFixed(2))
              const ok = Math.abs(remaining) < 0.01
              const remColor = ok ? '#1DB954' : remaining > 0 ? '#f57c00' : '#e53935'
              return (
                <>
                  <Text style={styles.assignHint}>Assign items to auto-fill — or type amounts directly</Text>
                  {items.map((item, i) => {
                    const assignment = itemAssignments[i] ?? 'split'
                    return (
                      <View key={i} style={styles.exactItemCard}>
                        <View style={styles.exactItemTop}>
                          <Text style={styles.exactItemName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.exactItemPrice}>${item.total_price.toFixed(2)}</Text>
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                          <TouchableOpacity style={[styles.assignBtn, assignment === 'split' && styles.assignBtnSplit]} onPress={() => assignItem(i, 'split')}>
                            <Text style={[styles.assignBtnText, assignment === 'split' && styles.assignBtnTextActive]}>⚖️ Split</Text>
                          </TouchableOpacity>
                          {members.map((m: any) => (
                            <TouchableOpacity key={m.profiles.id} style={[styles.assignBtn, assignment === m.profiles.id && styles.assignBtnMember]} onPress={() => assignItem(i, m.profiles.id)}>
                              <Text style={[styles.assignBtnText, assignment === m.profiles.id && styles.assignBtnTextActive]}>{m.profiles.full_name?.split(' ')[0]}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )
                  })}
                  <View style={[styles.remBar, { backgroundColor: ok ? '#e8f9ee' : '#fff3e0' }]}>
                    <Ionicons name={ok ? 'checkmark-circle' : 'information-circle'} size={15} color={remColor} />
                    <Text style={[styles.remText, { color: remColor }]}>
                      {ok ? 'Amounts balance out ✓' : remaining > 0 ? `$${remaining.toFixed(2)} left to assign` : `Over by $${Math.abs(remaining).toFixed(2)}`}
                    </Text>
                  </View>
                  {members.map((m: any) => (
                    <View key={m.profiles.id} style={styles.exactRow}>
                      <View style={styles.summaryAvatar}><Text style={styles.summaryAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text></View>
                      <Text style={styles.exactName}>{m.profiles.full_name?.split(' ')[0]}</Text>
                      <View style={styles.exactInputBox}>
                        <Text style={styles.dollarSignSmall}>$</Text>
                        <TextInput style={styles.exactInput} placeholder="0.00" value={exactAmounts[m.profiles.id] || ''} onChangeText={v => setExactAmounts(prev => ({ ...prev, [m.profiles.id]: v }))} keyboardType="decimal-pad" />
                      </View>
                    </View>
                  ))}
                </>
              )
            })()}

            {/* ══ PERCENTAGE mode ══ */}
            {splitMode === 'percentage' && (() => {
              const pctSum = members.reduce((s: number, m: any) => s + (parseFloat(percentages[m.profiles.id]) || 0), 0)
              const pctRem = parseFloat((100 - pctSum).toFixed(1))
              const ok = Math.abs(pctRem) < 0.1
              const remColor = ok ? '#1DB954' : pctRem > 0 ? '#f57c00' : '#e53935'
              return (
                <>
                  <View style={styles.pctHeader}>
                    <Text style={styles.assignHint}>Must total 100%</Text>
                    <TouchableOpacity style={styles.eqBtn} onPress={splitPctEqually}>
                      <Text style={styles.eqBtnText}>Split Equally</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.remBar, { backgroundColor: ok ? '#e8f9ee' : '#fff3e0' }]}>
                    <Ionicons name={ok ? 'checkmark-circle' : 'information-circle'} size={15} color={remColor} />
                    <Text style={[styles.remText, { color: remColor }]}>
                      {ok ? '100% assigned ✓' : pctRem > 0 ? `${pctRem.toFixed(1)}% remaining` : `${Math.abs(pctRem).toFixed(1)}% over 100%`}
                    </Text>
                  </View>
                  {members.map((m: any) => {
                    const pct = parseFloat(percentages[m.profiles.id]) || 0
                    const amt = finalTotal * pct / 100
                    return (
                      <View key={m.profiles.id} style={styles.exactRow}>
                        <View style={styles.summaryAvatar}><Text style={styles.summaryAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.exactName}>{m.profiles.full_name?.split(' ')[0]}</Text>
                          {finalTotal > 0 && <Text style={styles.calcAmt}>${amt.toFixed(2)}</Text>}
                        </View>
                        <View style={styles.pctInputBox}>
                          <TextInput style={styles.exactInput} placeholder="0" value={percentages[m.profiles.id] || ''} onChangeText={v => setPercentages(prev => ({ ...prev, [m.profiles.id]: v }))} keyboardType="decimal-pad" />
                          <Text style={styles.pctSign}>%</Text>
                        </View>
                      </View>
                    )
                  })}
                </>
              )
            })()}

            {/* ══ SHARES mode ══ */}
            {splitMode === 'shares' && (() => {
              const totalSh = members.reduce((s: number, m: any) => s + (parseInt(sharesCount[m.profiles.id]) || 0), 0)
              return (
                <>
                  {totalSh > 0 && finalTotal > 0 && (
                    <View style={styles.sharesBadge}>
                      <Text style={styles.sharesBadgeText}>{totalSh} total shares · ${(finalTotal / totalSh).toFixed(2)} per share</Text>
                    </View>
                  )}
                  {members.map((m: any) => {
                    const s = parseInt(sharesCount[m.profiles.id]) || 0
                    const amt = totalSh > 0 ? finalTotal * s / totalSh : 0
                    return (
                      <View key={m.profiles.id} style={styles.exactRow}>
                        <View style={styles.summaryAvatar}><Text style={styles.summaryAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.exactName}>{m.profiles.full_name?.split(' ')[0]}</Text>
                          {finalTotal > 0 && s > 0 && <Text style={styles.calcAmt}>${amt.toFixed(2)}</Text>}
                        </View>
                        <View style={styles.sharesBox}>
                          <TouchableOpacity style={styles.sharesBtn} onPress={() => setSharesCount(prev => ({ ...prev, [m.profiles.id]: String(Math.max(0, (parseInt(prev[m.profiles.id]) || 1) - 1)) }))}>
                            <Text style={styles.sharesBtnText}>−</Text>
                          </TouchableOpacity>
                          <TextInput style={styles.sharesInput} value={sharesCount[m.profiles.id] || '1'} onChangeText={v => setSharesCount(prev => ({ ...prev, [m.profiles.id]: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" />
                          <TouchableOpacity style={styles.sharesBtn} onPress={() => setSharesCount(prev => ({ ...prev, [m.profiles.id]: String((parseInt(prev[m.profiles.id]) || 0) + 1) }))}>
                            <Text style={styles.sharesBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )
                  })}
                </>
              )
            })()}

            {/* ══ BY ITEMS mode ══ */}
            {splitMode === 'items' && (
              <>
                <Text style={styles.assignHint}>Tap a name to assign each item — or ⚖️ Split to divide equally</Text>
                {items.map((item, i) => {
                  const assignment = itemAssignments[i] ?? 'split'
                  return (
                    <View key={i} style={styles.assignRow}>
                      <View style={styles.assignItemInfo}>
                        <Text style={styles.assignItemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.assignItemPrice}>${item.total_price.toFixed(2)}</Text>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assignButtons}>
                        <TouchableOpacity style={[styles.assignBtn, assignment === 'split' && styles.assignBtnSplit]} onPress={() => assignItem(i, 'split')}>
                          <Text style={[styles.assignBtnText, assignment === 'split' && styles.assignBtnTextActive]}>⚖️ Split</Text>
                        </TouchableOpacity>
                        {members.map((m: any) => (
                          <TouchableOpacity key={m.profiles.id} style={[styles.assignBtn, assignment === m.profiles.id && styles.assignBtnMember]} onPress={() => assignItem(i, m.profiles.id)}>
                            <Text style={[styles.assignBtnText, assignment === m.profiles.id && styles.assignBtnTextActive]}>{m.profiles.full_name?.split(' ')[0]}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )
                })}
                {tax > 0 && (
                  <View style={[styles.assignRow, { backgroundColor: '#fffde7' }]}>
                    <View style={styles.assignItemInfo}>
                      <Text style={styles.assignItemName}>Tax / Other</Text>
                      <Text style={styles.assignItemPrice}>${tax.toFixed(2)}</Text>
                    </View>
                    <View style={styles.assignButtons}>
                      <View style={[styles.assignBtn, styles.assignBtnSplit]}>
                        <Text style={[styles.assignBtnText, styles.assignBtnTextActive]}>⚖️ Split (auto)</Text>
                      </View>
                    </View>
                  </View>
                )}
              </>
            )}

            {/* ── Per-person summary (all modes) ── */}
            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>💰 Each person owes</Text>
              {members.map((m: any) => {
                const amt = perPerson[m.profiles.id] || 0
                return (
                  <View key={m.profiles.id} style={styles.summaryRow}>
                    <View style={styles.summaryAvatar}>
                      <Text style={styles.summaryAvatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.summaryName}>{m.profiles.full_name}</Text>
                    <Text style={[styles.summaryAmt, amt > 0 && { color: '#e53935' }]}>
                      ${amt.toFixed(2)}
                    </Text>
                  </View>
                )
              })}
            </View>
          </>
        )}

        <TouchableOpacity
          style={[styles.nextBtn, { marginTop: 8 }, (!selectedGroup || !paidBy) && styles.btnDisabled]}
          onPress={saveBill}
          disabled={saving || !selectedGroup || !paidBy}
        >
          <Text style={styles.nextBtnText}>
            {saving ? 'Saving...' : `Save & Split $${finalTotal.toFixed(2)}`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.retakeBtn} onPress={() => setStep('review')}>
          <Text style={styles.retakeBtnText}>← Back to Review</Text>
        </TouchableOpacity>

        {/* Group Picker Modal */}
        <Modal visible={groupModalVisible} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Select Group</Text>
              {groups.length === 0 ? (
                <Text style={styles.noGroupsText}>No groups found. Create a group first.</Text>
              ) : (
                <FlatList
                  data={groups}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.groupOption} onPress={() => selectGroup(item)}>
                      <View style={styles.groupOptionAvatar}>
                        <Text style={styles.groupOptionAvatarText}>{item.name[0].toUpperCase()}</Text>
                      </View>
                      <Text style={styles.groupOptionText}>{item.name}</Text>
                      <Ionicons name="chevron-forward" size={18} color="#ccc" />
                    </TouchableOpacity>
                  )}
                />
              )}
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setGroupModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    )
  }

  // ── STEP: MANUAL ──
  if (step === 'manual') return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={resetScanner}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.title}>Manual Entry</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Description */}
      <Text style={styles.label}>Description *</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Dinner at Chipotle, Gas at Shell"
        value={manualDesc}
        onChangeText={setManualDesc}
      />

      {/* Store name */}
      <Text style={styles.label}>Store / Restaurant (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Chipotle, Shell, CVS"
        value={manualStore}
        onChangeText={setManualStore}
      />

      {/* Items */}
      <Text style={styles.label}>Items (optional)</Text>
      {manualItems.map((item, i) => (
        <View key={i} style={styles.manualItemRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Item name"
            value={item.name}
            onChangeText={v => updateManualItem(i, 'name', v)}
          />
          <View style={styles.manualPriceBox}>
            <Text style={styles.dollarSign}>$</Text>
            <TextInput
              style={styles.manualPriceInput}
              placeholder="0.00"
              value={item.price}
              onChangeText={v => updateManualItem(i, 'price', v)}
              keyboardType="decimal-pad"
            />
          </View>
          {manualItems.length > 1 && (
            <TouchableOpacity onPress={() => removeManualItem(i)} style={{ padding: 8 }}>
              <Ionicons name="trash-outline" size={18} color="#ff4444" />
            </TouchableOpacity>
          )}
        </View>
      ))}
      <TouchableOpacity style={styles.addItemBtn} onPress={addManualItem}>
        <Ionicons name="add-circle-outline" size={20} color="#1DB954" />
        <Text style={styles.addItemText}>Add Item</Text>
      </TouchableOpacity>

      {/* Total override */}
      <Text style={styles.label}>
        Total Amount {manualItemsTotal > 0 ? `(auto: $${manualItemsTotal.toFixed(2)})` : '*'}
      </Text>
      <TextInput
        style={styles.input}
        placeholder={manualItemsTotal > 0 ? `${manualItemsTotal.toFixed(2)} (or override)` : '0.00'}
        value={manualAmount}
        onChangeText={setManualAmount}
        keyboardType="decimal-pad"
      />

      {manualFinalTotal > 0 && (
        <View style={styles.splitTotalBadge}>
          <Text style={styles.splitTotalText}>Total: ${manualFinalTotal.toFixed(2)}</Text>
        </View>
      )}

      {/* Group */}
      <Text style={styles.label}>Group *</Text>
      <TouchableOpacity
        style={styles.selector}
        onPress={() => { loadGroups(); setGroupModalVisible(true) }}
      >
        <Text style={selectedGroup ? styles.selectorText : styles.selectorPlaceholder}>
          {selectedGroup ? selectedGroup.name : 'Choose a group...'}
        </Text>
        <Ionicons name="chevron-down" size={20} color="#999" />
      </TouchableOpacity>

      {/* Who paid */}
      {members.length > 0 && (
        <>
          <Text style={styles.label}>Who paid?</Text>
          {members.map((m: any) => (
            <TouchableOpacity
              key={m.profiles.id}
              style={[styles.memberOption, paidBy === m.profiles.id && styles.memberSelected]}
              onPress={() => setPaidBy(m.profiles.id)}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{m.profiles.full_name?.[0]?.toUpperCase()}</Text>
              </View>
              <Text style={styles.memberName}>{m.profiles.full_name}</Text>
              {paidBy === m.profiles.id && <Ionicons name="checkmark-circle" size={22} color="#1DB954" />}
            </TouchableOpacity>
          ))}
          <View style={styles.splitInfo}>
            <Ionicons name="information-circle" size={18} color="#1DB954" />
            <Text style={styles.splitInfoText}>
              Split equally — ${members.length > 0 ? (manualFinalTotal / members.length).toFixed(2) : '0.00'} per person
            </Text>
          </View>
        </>
      )}

      <TouchableOpacity
        style={[styles.nextBtn, { marginTop: 16 }, (saving || !selectedGroup || !paidBy || manualFinalTotal <= 0) && styles.btnDisabled]}
        onPress={saveManualBill}
        disabled={saving || !selectedGroup || !paidBy || manualFinalTotal <= 0}
      >
        <Text style={styles.nextBtnText}>
          {saving ? 'Saving...' : `Save & Split $${manualFinalTotal.toFixed(2)}`}
        </Text>
      </TouchableOpacity>

      {/* Group picker modal */}
      <Modal visible={groupModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Select Group</Text>
            {groups.length === 0 ? (
              <Text style={styles.noGroupsText}>No groups found. Create a group first.</Text>
            ) : (
              <FlatList
                data={groups}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.groupOption} onPress={() => selectGroup(item)}>
                    <View style={styles.groupOptionAvatar}>
                      <Text style={styles.groupOptionAvatarText}>{item.name[0].toUpperCase()}</Text>
                    </View>
                    <Text style={styles.groupOptionText}>{item.name}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#ccc" />
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setGroupModalVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  )

  // ── STEP: DONE ──
  return (
    <View style={styles.container}>
      <View style={styles.doneBox}>
        <Ionicons name="checkmark-circle" size={90} color="#1DB954" />
        <Text style={styles.doneTitle}>Bill Saved!</Text>
        <Text style={styles.doneSubtitle}>
          ${finalTotal.toFixed(2)} split in {selectedGroup?.name}
        </Text>
        <Text style={styles.doneSubtitle}>
          ${(finalTotal / members.length).toFixed(2)} per person
        </Text>

        <TouchableOpacity
          style={[styles.nextBtn, { marginTop: 32, width: '100%', backgroundColor: '#1a1a1a' }]}
          onPress={() => router.push(`/(tabs)/price-compass?billId=${savedBillId}`)}
        >
          <Text style={styles.nextBtnText}>🧭 Compare Prices at DMV Stores</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.nextBtn, { width: '100%' }]}
          onPress={resetScanner}
        >
          <Text style={styles.nextBtnText}>Scan Another Bill</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#999', marginBottom: 24 },

  scanningBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  scanningText: { fontSize: 18, fontWeight: '600', color: '#1a1a1a' },
  scanningSubtext: { fontSize: 14, color: '#999' },

  optionsBox: { flexDirection: 'row', gap: 16, marginTop: 16 },
  optionBtn: {
    flex: 1, backgroundColor: '#f9f9f9', borderRadius: 16,
    padding: 24, alignItems: 'center', gap: 12,
  },
  optionIcon: {
    width: 72, height: 72, backgroundColor: '#e8f9ee',
    borderRadius: 36, justifyContent: 'center', alignItems: 'center',
  },
  optionTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  optionSubtitle: { fontSize: 13, color: '#999' },

  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  storeName: { fontSize: 15, color: '#555', fontWeight: '500' },

  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f9f9f9', borderRadius: 12,
    padding: 12, marginBottom: 8,
  },
  itemMain: { flex: 1 },
  itemName: {
    fontSize: 15, fontWeight: '500', color: '#1a1a1a',
    borderBottomWidth: 1, borderBottomColor: '#eee',
    paddingBottom: 6, marginBottom: 6,
  },
  itemPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemQtyLabel: { fontSize: 13, color: '#999' },
  itemQtyInput: {
    fontSize: 13, color: '#555', borderWidth: 1, borderColor: '#ddd',
    borderRadius: 6, padding: 3, width: 36, textAlign: 'center',
  },
  dollarSign: { fontSize: 14, color: '#999', marginLeft: 8 },
  itemPrice: {
    fontSize: 15, fontWeight: '600', color: '#1DB954',
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6,
    padding: 4, minWidth: 64, textAlign: 'right',
  },
  deleteBtn: { padding: 8 },

  addItemBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 14, borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 12, marginVertical: 12, gap: 8, borderStyle: 'dashed',
  },
  addItemText: { color: '#1DB954', fontSize: 15, fontWeight: '600' },

  totalsBox: { backgroundColor: '#f9f9f9', borderRadius: 14, padding: 16, marginBottom: 20 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  totalLabel: { fontSize: 15, color: '#555' },
  totalValue: { fontSize: 15, color: '#333', fontWeight: '500' },
  grandTotalRow: {
    borderTopWidth: 1, borderTopColor: '#e0e0e0',
    paddingTop: 10, marginBottom: 0,
  },
  grandTotalLabel: { fontSize: 17, fontWeight: 'bold', color: '#1a1a1a' },
  grandTotalValue: { fontSize: 17, fontWeight: 'bold', color: '#1DB954' },

  nextBtn: {
    backgroundColor: '#1DB954', padding: 16,
    borderRadius: 12, alignItems: 'center', marginBottom: 12,
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDisabled: { backgroundColor: '#ccc' },
  retakeBtn: { padding: 12, alignItems: 'center', marginBottom: 12 },
  retakeBtnText: { color: '#999', fontSize: 15 },

  splitTotalBadge: {
    backgroundColor: '#e8f9ee', padding: 12,
    borderRadius: 10, marginBottom: 16, alignItems: 'center',
  },
  splitTotalText: { color: '#1DB954', fontWeight: '700', fontSize: 16 },

  label: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },

  selector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12,
    padding: 14, backgroundColor: '#fafafa',
  },
  selectorText: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  selectorPlaceholder: { fontSize: 15, color: '#aaa' },

  memberOption: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#eee',
    marginBottom: 8, backgroundColor: '#fafafa', gap: 12,
  },
  memberSelected: { borderColor: '#1DB954', backgroundColor: '#f0fdf4' },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberName: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '500' },

  splitInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#e8f9ee', borderRadius: 10,
    padding: 12, marginTop: 4, marginBottom: 16,
  },
  splitInfoText: { fontSize: 14, color: '#1DB954', fontWeight: '500', flex: 1 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 24, maxHeight: '70%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 16 },
  noGroupsText: { fontSize: 15, color: '#999', textAlign: 'center', padding: 20 },
  groupOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  groupOptionAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  groupOptionAvatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  groupOptionText: { flex: 1, fontSize: 16, color: '#1a1a1a', fontWeight: '500' },
  cancelBtn: {
    marginTop: 16, padding: 14,
    borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f5f5',
  },
  cancelText: { fontSize: 16, color: '#666', fontWeight: '600' },

  doneBox: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 16, gap: 8,
  },
  doneTitle: { fontSize: 32, fontWeight: 'bold', color: '#1a1a1a', marginTop: 16 },
  doneSubtitle: { fontSize: 16, color: '#666', marginBottom: 4 },

  // Who paid chips
  paidByChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 24,
    paddingHorizontal: 12, paddingVertical: 8,
    marginRight: 8, backgroundColor: '#fafafa',
  },
  paidByChipSelected: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  chipAvatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#ccc', justifyContent: 'center', alignItems: 'center',
  },
  chipAvatarSelected: { backgroundColor: '#1DB954' },
  chipAvatarText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  chipName: { fontSize: 13, color: '#555', fontWeight: '500' },
  chipNameSelected: { color: '#1DB954', fontWeight: '700' },

  // Item assignment
  assignHint: { fontSize: 12, color: '#aaa', marginBottom: 10, marginTop: -4 },
  assignRow: {
    backgroundColor: '#f9f9f9', borderRadius: 12,
    padding: 12, marginBottom: 8,
  },
  assignItemInfo: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  assignItemName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  assignItemPrice: { fontSize: 14, fontWeight: '700', color: '#1DB954' },
  assignButtons: { flexDirection: 'row' },
  assignBtn: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 6, backgroundColor: '#fff',
  },
  assignBtnSplit: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  assignBtnMember: { borderColor: '#1a1a1a', backgroundColor: '#1a1a1a' },
  assignBtnText: { fontSize: 12, color: '#999', fontWeight: '600' },
  assignBtnTextActive: { color: '#1DB954' },

  // Per-person summary
  summaryBox: {
    backgroundColor: '#f0fdf4', borderRadius: 14,
    padding: 16, marginVertical: 16,
    borderWidth: 1.5, borderColor: '#bbf7d0',
  },
  summaryTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  summaryRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginBottom: 8,
  },
  summaryAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  summaryAvatarText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  summaryName: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  summaryAmt: { fontSize: 17, fontWeight: '800', color: '#1a1a1a' },

  // Manual entry
  dividerRow: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 20, gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e0e0e0' },
  dividerText: { fontSize: 14, color: '#aaa', fontWeight: '500' },
  manualBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#f9f9f9', borderRadius: 16,
    padding: 18, borderWidth: 1.5, borderColor: '#e0e0e0',
  },
  manualBtnIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#e8f9ee', justifyContent: 'center', alignItems: 'center',
  },
  manualBtnTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  manualBtnSub: { fontSize: 13, color: '#999', marginTop: 2 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 12, padding: 14, fontSize: 15,
    marginBottom: 4, backgroundColor: '#fafafa',
  },
  manualItemRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginBottom: 8,
  },
  manualPriceBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 12, paddingHorizontal: 10,
    backgroundColor: '#fafafa', width: 90,
  },
  manualPriceInput: {
    fontSize: 15, flex: 1, padding: 14,
    color: '#1a1a1a',
  },

  // Exact mode item cards
  exactItemCard: {
    backgroundColor: '#fafafa', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#e0e0e0',
    padding: 12, marginBottom: 8,
  },
  exactItemTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  exactItemName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginRight: 8 },
  exactItemPrice: { fontSize: 14, fontWeight: '700', color: '#1DB954' },

  // Split mode tabs (horizontal scroll)
  modeTab: {
    width: 80, paddingVertical: 10, paddingHorizontal: 6,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0',
    backgroundColor: '#f9f9f9', alignItems: 'center', gap: 3,
    marginRight: 8,
  },
  modeTabActive: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  modeTabEmoji: { fontSize: 16 },
  modeTabText: { fontSize: 11, fontWeight: '700', color: '#999', textAlign: 'center' },
  modeTabTextActive: { color: '#1DB954' },

  // Equal mode — member grid
  memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  memberTile: {
    width: '30%', borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 14, padding: 10, alignItems: 'center', gap: 5,
    backgroundColor: '#fafafa',
  },
  memberTileActive: { borderColor: '#1DB954', backgroundColor: '#f0fdf4' },
  tileAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#ddd', justifyContent: 'center', alignItems: 'center',
  },
  tileAvatarActive: { backgroundColor: '#1DB954' },
  tileAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  tileName: { fontSize: 11, fontWeight: '600', color: '#aaa', textAlign: 'center' },

  // Shared remaining bar
  remBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, borderRadius: 10, marginBottom: 12,
  },
  remText: { fontSize: 13, fontWeight: '600', flex: 1 },

  // Exact mode item cards (reused from earlier)
  exactItemCard: {
    backgroundColor: '#fafafa', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#e0e0e0',
    padding: 12, marginBottom: 8,
  },
  exactItemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exactItemName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginRight: 8 },
  exactItemPrice: { fontSize: 14, fontWeight: '700', color: '#1DB954' },

  // Shared exact row (used by exact, percentage, shares)
  exactRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginBottom: 10,
    backgroundColor: '#f9f9f9', borderRadius: 12, padding: 12,
  },
  exactName: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  calcAmt: { fontSize: 12, color: '#1DB954', fontWeight: '600', marginTop: 2 },
  exactInputBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, paddingHorizontal: 8,
    backgroundColor: '#fff', width: 100,
  },
  dollarSignSmall: { fontSize: 14, color: '#999', fontWeight: '600' },
  exactInput: { fontSize: 15, padding: 10, flex: 1, color: '#1a1a1a', fontWeight: '600' },

  // Percentage mode
  pctHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  eqBtn: {
    backgroundColor: '#e8f9ee', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#1DB954',
  },
  eqBtnText: { fontSize: 12, color: '#1DB954', fontWeight: '700' },
  pctInputBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, paddingHorizontal: 8,
    backgroundColor: '#fff', width: 80,
  },
  pctSign: { fontSize: 15, color: '#1DB954', fontWeight: '700' },

  // Shares mode
  sharesBadge: {
    backgroundColor: '#f0f8ff', borderRadius: 10,
    padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#90caf9', alignItems: 'center',
  },
  sharesBadgeText: { fontSize: 13, color: '#1565c0', fontWeight: '600' },
  sharesBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff',
  },
  sharesBtn: {
    width: 30, height: 38, justifyContent: 'center',
    alignItems: 'center', backgroundColor: '#e8f9ee',
  },
  sharesBtnText: { fontSize: 18, color: '#1DB954', fontWeight: '700' },
  sharesInput: {
    width: 36, textAlign: 'center',
    fontSize: 15, fontWeight: '700', color: '#1a1a1a', padding: 6,
  },
})
