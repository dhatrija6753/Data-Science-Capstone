import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'

type SplitMode = 'equal' | 'exact' | 'percentage' | 'shares' | 'items'
type Item = { name: string; price: string; assignedTo: string }

const MODES: { key: SplitMode; emoji: string; label: string; sub: string }[] = [
  { key: 'equal',      emoji: '⚖️', label: 'Equal',    sub: 'Split evenly' },
  { key: 'exact',      emoji: '✏️', label: 'Exact $',  sub: 'Enter amounts' },
  { key: 'percentage', emoji: '%',  label: 'Percent',  sub: 'By percentage' },
  { key: 'shares',     emoji: '#',  label: 'Shares',   sub: 'Ratio split' },
  { key: 'items',      emoji: '🧾', label: 'By Items', sub: 'Assign items' },
]

export default function AddExpenseScreen() {
  const { id, members } = useLocalSearchParams()
  const router = useRouter()
  const parsedMembers: any[] = JSON.parse(members as string || '[]')

  const [description, setDescription] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [paidBy, setPaidBy] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')

  // Equal mode — who's included
  const [includedMembers, setIncludedMembers] = useState<Set<string>>(
    new Set(parsedMembers.map(m => m.id))
  )

  // Exact mode
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>(
    Object.fromEntries(parsedMembers.map(m => [m.id, '']))
  )

  // Percentage mode
  const eqPct = parsedMembers.length > 0
    ? (100 / parsedMembers.length).toFixed(1) : '0'
  const [percentages, setPercentages] = useState<Record<string, string>>(
    Object.fromEntries(parsedMembers.map(m => [m.id, eqPct]))
  )

  // Shares mode
  const [sharesCount, setSharesCount] = useState<Record<string, string>>(
    Object.fromEntries(parsedMembers.map(m => [m.id, '1']))
  )

  // Items mode
  const [items, setItems] = useState<Item[]>([{ name: '', price: '', assignedTo: 'split' }])

  // ── Derived totals ────────────────────────────────────────────────────────
  const total = parseFloat(totalAmount) || 0
  const itemsTotal = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0)
  const finalTotal = splitMode === 'items' ? itemsTotal : total

  const exactSum = Object.values(exactAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const exactRemaining = parseFloat((finalTotal - exactSum).toFixed(2))

  const pctSum = Object.values(percentages).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const pctRemaining = parseFloat((100 - pctSum).toFixed(1))

  const totalSharesCount = Object.values(sharesCount).reduce((s, v) => s + (parseInt(v) || 0), 0)

  const includedList = parsedMembers.filter(m => includedMembers.has(m.id))

  // ── Auto-fill exact amounts from item assignments ─────────────────────────
  useEffect(() => {
    if (splitMode !== 'exact' || parsedMembers.length === 0) return
    const newAmts: Record<string, string> = {}
    parsedMembers.forEach(m => { newAmts[m.id] = '0.00' })
    items.forEach(item => {
      const price = parseFloat(item.price) || 0
      if (price <= 0) return
      if (item.assignedTo === 'split') {
        parsedMembers.forEach(m => {
          newAmts[m.id] = ((parseFloat(newAmts[m.id]) || 0) + price / parsedMembers.length).toFixed(2)
        })
      } else if (newAmts[item.assignedTo] !== undefined) {
        newAmts[item.assignedTo] = ((parseFloat(newAmts[item.assignedTo]) || 0) + price).toFixed(2)
      }
    })
    setExactAmounts(newAmts)
  }, [items, splitMode])

  // ── Per-person calculation ─────────────────────────────────────────────────
  function calcPerPerson(): Record<string, number> {
    const out: Record<string, number> = {}
    parsedMembers.forEach(m => { out[m.id] = 0 })

    if (splitMode === 'equal') {
      if (includedList.length > 0) {
        const each = finalTotal / includedList.length
        includedList.forEach(m => { out[m.id] = each })
      }

    } else if (splitMode === 'exact') {
      parsedMembers.forEach(m => { out[m.id] = parseFloat(exactAmounts[m.id]) || 0 })

    } else if (splitMode === 'percentage') {
      parsedMembers.forEach(m => {
        out[m.id] = finalTotal * (parseFloat(percentages[m.id]) || 0) / 100
      })

    } else if (splitMode === 'shares') {
      if (totalSharesCount > 0) {
        parsedMembers.forEach(m => {
          out[m.id] = finalTotal * (parseInt(sharesCount[m.id]) || 0) / totalSharesCount
        })
      }

    } else {
      // items mode
      items.forEach(item => {
        const price = parseFloat(item.price) || 0
        if (price <= 0) return
        if (item.assignedTo === 'split') {
          parsedMembers.forEach(m => { out[m.id] += price / parsedMembers.length })
        } else if (out[item.assignedTo] !== undefined) {
          out[item.assignedTo] += price
        }
      })
    }
    return out
  }

  // ── Item helpers ──────────────────────────────────────────────────────────
  function addItem() { setItems(p => [...p, { name: '', price: '', assignedTo: 'split' }]) }
  function removeItem(i: number) { if (items.length > 1) setItems(p => p.filter((_, j) => j !== i)) }
  function updateItem(i: number, field: keyof Item, val: string) {
    setItems(p => { const u = [...p]; u[i] = { ...u[i], [field]: val }; return u })
  }

  function toggleMember(id: string) {
    setIncludedMembers(prev => {
      const next = new Set(prev)
      if (next.has(id)) { if (next.size > 1) next.delete(id) }
      else next.add(id)
      return next
    })
  }

  function splitPctEqually() {
    const each = (100 / parsedMembers.length).toFixed(1)
    setPercentages(Object.fromEntries(parsedMembers.map(m => [m.id, each])))
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!description.trim()) return 'Enter a description'
    if (finalTotal <= 0) return 'Enter a total amount'
    if (!paidBy) return 'Select who paid'
    if (parsedMembers.length === 0) return 'No members in group'
    if (splitMode === 'equal' && includedList.length === 0)
      return 'Select at least one person to split with'
    if (splitMode === 'exact' && Math.abs(exactRemaining) > 0.01)
      return `Amounts don't add up — $${Math.abs(exactRemaining).toFixed(2)} ${exactRemaining > 0 ? 'remaining' : 'over'}`
    if (splitMode === 'percentage' && Math.abs(pctRemaining) > 0.1)
      return `Percentages must total 100% (${pctSum.toFixed(1)}% entered)`
    if (splitMode === 'shares' && totalSharesCount === 0)
      return 'Enter at least one share'
    return null
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function saveExpense() {
    const err = validate()
    if (err) return Alert.alert('Error', err)
    setSaving(true)

    const { data: bill, error } = await supabase
      .from('bills')
      .insert({
        group_id: id,
        paid_by: paidBy,
        description: description.trim(),
        total_amount: parseFloat(finalTotal.toFixed(2)),
        split_type: splitMode,
        bill_date: new Date().toISOString().split('T')[0],
      })
      .select().single()

    if (error) { Alert.alert('Error', error.message); setSaving(false); return }

    // Save items (items + exact mode)
    if (splitMode === 'items' || splitMode === 'exact') {
      const valid = items.filter(i => i.name.trim() && parseFloat(i.price) > 0)
      if (valid.length > 0) {
        await supabase.from('bill_items').insert(
          valid.map(i => ({
            bill_id: bill.id,
            name: i.name.trim(),
            quantity: 1,
            unit_price: parseFloat(i.price),
            total_price: parseFloat(i.price),
            assigned_to: i.assignedTo === 'split' ? null : i.assignedTo,
          }))
        )
      }
    }

    const perPerson = calcPerPerson()
    // Only save splits for people with non-zero amounts
    const splits = parsedMembers
      .map(m => ({
        bill_id: bill.id,
        user_id: m.id,
        amount_owed: parseFloat((perPerson[m.id] || 0).toFixed(2)),
      }))
      .filter(s => s.amount_owed > 0)

    await supabase.from('bill_splits').insert(splits)

    setSaving(false)
    Alert.alert('Done! 🎉', `$${finalTotal.toFixed(2)} split across ${splits.length} people`, [
      { text: 'OK', onPress: () => router.back() }
    ])
  }

  const perPerson = calcPerPerson()

  // ── Remaining badge helper ────────────────────────────────────────────────
  function RemainingBadge({ ok, msg }: { ok: boolean; over?: boolean; msg: string }) {
    const color = ok ? '#1DB954' : '#f57c00'
    const bg = ok ? '#e8f9ee' : '#fff3e0'
    return (
      <View style={[styles.remainingBar, { backgroundColor: bg }]}>
        <Ionicons name={ok ? 'checkmark-circle' : 'information-circle'} size={15} color={color} />
        <Text style={[styles.remainingText, { color }]}>{msg}</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 80 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.title}>Add Expense</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.form}>

        {/* Description */}
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Grocery run, Dinner, Gas"
          value={description}
          onChangeText={setDescription}
        />

        {/* Total (not shown for items mode) */}
        {splitMode !== 'items' && (
          <>
            <Text style={styles.label}>Total Amount</Text>
            <View style={styles.amountRow}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="0.00"
                value={totalAmount}
                onChangeText={setTotalAmount}
                keyboardType="decimal-pad"
              />
            </View>
          </>
        )}

        {/* ── Split Mode Selector ── */}
        <Text style={styles.label}>How to split?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
          {MODES.map(mode => (
            <TouchableOpacity
              key={mode.key}
              style={[styles.modeBtn, splitMode === mode.key && styles.modeBtnActive]}
              onPress={() => setSplitMode(mode.key)}
            >
              <Text style={styles.modeEmoji}>{mode.emoji}</Text>
              <Text style={[styles.modeBtnText, splitMode === mode.key && styles.modeBtnTextActive]}>
                {mode.label}
              </Text>
              <Text style={[styles.modeBtnSub, splitMode === mode.key && { color: '#1DB954' }]}>
                {mode.key === 'equal' && finalTotal > 0 && includedList.length > 0
                  ? `$${(finalTotal / includedList.length).toFixed(2)} ea`
                  : mode.sub}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ══ EQUAL MODE ══ */}
        {splitMode === 'equal' && (
          <>
            <Text style={styles.sectionHint}>Tap to include/exclude people from the split</Text>
            <View style={styles.memberGrid}>
              {parsedMembers.map(m => {
                const included = includedMembers.has(m.id)
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberTile, included && styles.memberTileActive]}
                    onPress={() => toggleMember(m.id)}
                  >
                    <View style={[styles.tileAvatar, included && styles.tileAvatarActive]}>
                      <Text style={styles.tileAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
                    </View>
                    <Text style={[styles.tileName, included && { color: '#1a1a1a' }]} numberOfLines={1}>
                      {m.full_name?.split(' ')[0]}
                    </Text>
                    {included
                      ? <Ionicons name="checkmark-circle" size={16} color="#1DB954" />
                      : <Ionicons name="remove-circle-outline" size={16} color="#ccc" />}
                  </TouchableOpacity>
                )
              })}
            </View>
            {finalTotal > 0 && includedList.length > 0 && (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryTitle}>💰 Each person owes</Text>
                {includedList.map(m => (
                  <View key={m.id} style={styles.summaryRow}>
                    <View style={styles.summaryAvatar}>
                      <Text style={styles.summaryAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.summaryName}>{m.full_name}</Text>
                    <Text style={styles.summaryAmt}>${(finalTotal / includedList.length).toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ══ EXACT MODE ══ */}
        {splitMode === 'exact' && (
          <>
            <Text style={styles.sectionHint}>Assign items to auto-fill — or type amounts directly</Text>

            {items.map((item, i) => (
              <View key={i} style={styles.itemCard}>
                <View style={styles.itemTopRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Item name"
                    value={item.name}
                    onChangeText={v => updateItem(i, 'name', v)}
                  />
                  <View style={styles.priceBox}>
                    <Text style={styles.dollar}>$</Text>
                    <TextInput
                      style={styles.priceInput}
                      placeholder="0.00"
                      value={item.price}
                      onChangeText={v => updateItem(i, 'price', v)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  {items.length > 1 && (
                    <TouchableOpacity onPress={() => removeItem(i)} style={{ padding: 8 }}>
                      <Ionicons name="trash-outline" size={18} color="#ff4444" />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  <TouchableOpacity
                    style={[styles.assignBtn, item.assignedTo === 'split' && styles.assignBtnSplit]}
                    onPress={() => updateItem(i, 'assignedTo', 'split')}
                  >
                    <Text style={[styles.assignBtnText, item.assignedTo === 'split' && styles.assignBtnTextSplit]}>
                      ⚖️ Split
                    </Text>
                  </TouchableOpacity>
                  {parsedMembers.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.assignBtn, item.assignedTo === m.id && styles.assignBtnPerson]}
                      onPress={() => updateItem(i, 'assignedTo', m.id)}
                    >
                      <Text style={[styles.assignBtnText, item.assignedTo === m.id && { color: '#fff' }]}>
                        {m.full_name?.split(' ')[0] || 'User'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))}

            <TouchableOpacity style={styles.addItemBtn} onPress={addItem}>
              <Ionicons name="add-circle-outline" size={20} color="#1DB954" />
              <Text style={styles.addItemText}>Add Item</Text>
            </TouchableOpacity>

            {finalTotal > 0 && (
              <RemainingBadge
                ok={Math.abs(exactRemaining) < 0.01}
                msg={Math.abs(exactRemaining) < 0.01
                  ? 'Amounts match total ✓'
                  : exactRemaining > 0
                    ? `$${exactRemaining.toFixed(2)} left to assign`
                    : `$${Math.abs(exactRemaining).toFixed(2)} over total`}
              />
            )}

            {parsedMembers.map(m => (
              <View key={m.id} style={styles.exactRow}>
                <View style={styles.exactAvatar}>
                  <Text style={styles.exactAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
                </View>
                <Text style={styles.exactName}>{m.full_name}</Text>
                <View style={styles.exactInputBox}>
                  <Text style={styles.dollar}>$</Text>
                  <TextInput
                    style={styles.exactInput}
                    placeholder="0.00"
                    value={exactAmounts[m.id]}
                    onChangeText={v => setExactAmounts(prev => ({ ...prev, [m.id]: v }))}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            ))}
          </>
        )}

        {/* ══ PERCENTAGE MODE ══ */}
        {splitMode === 'percentage' && (
          <>
            <View style={styles.pctHeader}>
              <Text style={styles.sectionHint}>Percentages must total 100%</Text>
              <TouchableOpacity style={styles.eqBtn} onPress={splitPctEqually}>
                <Text style={styles.eqBtnText}>Split Equally</Text>
              </TouchableOpacity>
            </View>

            <RemainingBadge
              ok={Math.abs(pctRemaining) < 0.1}
              msg={Math.abs(pctRemaining) < 0.1
                ? '100% assigned ✓'
                : pctRemaining > 0
                  ? `${pctRemaining.toFixed(1)}% remaining`
                  : `${Math.abs(pctRemaining).toFixed(1)}% over 100%`}
            />

            {parsedMembers.map(m => {
              const pct = parseFloat(percentages[m.id]) || 0
              const amt = finalTotal * pct / 100
              return (
                <View key={m.id} style={styles.exactRow}>
                  <View style={styles.exactAvatar}>
                    <Text style={styles.exactAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exactName}>{m.full_name}</Text>
                    {finalTotal > 0 && (
                      <Text style={styles.calcAmt}>${amt.toFixed(2)}</Text>
                    )}
                  </View>
                  <View style={styles.pctInputBox}>
                    <TextInput
                      style={styles.exactInput}
                      placeholder="0"
                      value={percentages[m.id]}
                      onChangeText={v => setPercentages(prev => ({ ...prev, [m.id]: v }))}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.pctSign}>%</Text>
                  </View>
                </View>
              )
            })}
          </>
        )}

        {/* ══ SHARES MODE ══ */}
        {splitMode === 'shares' && (
          <>
            <Text style={styles.sectionHint}>
              Assign share counts — amounts split proportionally
            </Text>
            {totalSharesCount > 0 && finalTotal > 0 && (
              <View style={styles.sharesBadge}>
                <Text style={styles.sharesBadgeText}>
                  {totalSharesCount} total shares · ${(finalTotal / totalSharesCount).toFixed(2)} per share
                </Text>
              </View>
            )}

            {parsedMembers.map(m => {
              const s = parseInt(sharesCount[m.id]) || 0
              const amt = totalSharesCount > 0 ? finalTotal * s / totalSharesCount : 0
              return (
                <View key={m.id} style={styles.exactRow}>
                  <View style={styles.exactAvatar}>
                    <Text style={styles.exactAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exactName}>{m.full_name}</Text>
                    {finalTotal > 0 && s > 0 && (
                      <Text style={styles.calcAmt}>${amt.toFixed(2)}</Text>
                    )}
                  </View>
                  <View style={styles.sharesBox}>
                    <TouchableOpacity
                      style={styles.sharesBtn}
                      onPress={() => setSharesCount(prev => ({
                        ...prev, [m.id]: String(Math.max(0, (parseInt(prev[m.id]) || 1) - 1))
                      }))}
                    >
                      <Text style={styles.sharesBtnText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.sharesInput}
                      value={sharesCount[m.id]}
                      onChangeText={v => setSharesCount(prev => ({ ...prev, [m.id]: v.replace(/[^0-9]/g, '') }))}
                      keyboardType="number-pad"
                    />
                    <TouchableOpacity
                      style={styles.sharesBtn}
                      onPress={() => setSharesCount(prev => ({
                        ...prev, [m.id]: String((parseInt(prev[m.id]) || 0) + 1)
                      }))}
                    >
                      <Text style={styles.sharesBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })}
          </>
        )}

        {/* ══ BY ITEMS MODE ══ */}
        {splitMode === 'items' && (
          <>
            <Text style={styles.sectionHint}>Add items — tap a name to assign, or ⚖️ Split for equal</Text>

            {items.map((item, i) => (
              <View key={i} style={styles.itemCard}>
                <View style={styles.itemTopRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Item name"
                    value={item.name}
                    onChangeText={v => updateItem(i, 'name', v)}
                  />
                  <View style={styles.priceBox}>
                    <Text style={styles.dollar}>$</Text>
                    <TextInput
                      style={styles.priceInput}
                      placeholder="0.00"
                      value={item.price}
                      onChangeText={v => updateItem(i, 'price', v)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  {items.length > 1 && (
                    <TouchableOpacity onPress={() => removeItem(i)} style={{ padding: 8 }}>
                      <Ionicons name="trash-outline" size={18} color="#ff4444" />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  <TouchableOpacity
                    style={[styles.assignBtn, item.assignedTo === 'split' && styles.assignBtnSplit]}
                    onPress={() => updateItem(i, 'assignedTo', 'split')}
                  >
                    <Text style={[styles.assignBtnText, item.assignedTo === 'split' && styles.assignBtnTextSplit]}>
                      ⚖️ Split
                    </Text>
                  </TouchableOpacity>
                  {parsedMembers.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.assignBtn, item.assignedTo === m.id && styles.assignBtnPerson]}
                      onPress={() => updateItem(i, 'assignedTo', m.id)}
                    >
                      <Text style={[styles.assignBtnText, item.assignedTo === m.id && { color: '#fff' }]}>
                        {m.full_name?.split(' ')[0] || 'User'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))}

            <TouchableOpacity style={styles.addItemBtn} onPress={addItem}>
              <Ionicons name="add-circle-outline" size={20} color="#1DB954" />
              <Text style={styles.addItemText}>Add Item</Text>
            </TouchableOpacity>

            {itemsTotal > 0 && (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryTitle}>
                  💰 Each person owes · Total ${itemsTotal.toFixed(2)}
                </Text>
                {parsedMembers.map(m => (
                  <View key={m.id} style={styles.summaryRow}>
                    <View style={styles.summaryAvatar}>
                      <Text style={styles.summaryAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.summaryName}>{m.full_name}</Text>
                    <Text style={styles.summaryAmt}>${(perPerson[m.id] || 0).toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── Who Paid ── */}
        <Text style={styles.label}>Who paid?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          {parsedMembers.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[styles.paidChip, paidBy === m.id && styles.paidChipSelected]}
              onPress={() => setPaidBy(m.id)}
            >
              <View style={[styles.paidAvatar, paidBy === m.id && styles.paidAvatarSelected]}>
                <Text style={styles.paidAvatarText}>{m.full_name?.[0]?.toUpperCase()}</Text>
              </View>
              <Text style={[styles.paidName, paidBy === m.id && { color: '#1DB954', fontWeight: '700' }]}>
                {m.full_name?.split(' ')[0]}
              </Text>
              {paidBy === m.id && <Ionicons name="checkmark-circle" size={15} color="#1DB954" />}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, (saving || finalTotal <= 0 || !paidBy) && styles.saveBtnDisabled]}
          onPress={saveExpense}
          disabled={saving || finalTotal <= 0 || !paidBy}
        >
          <Text style={styles.saveBtnText}>
            {saving ? 'Saving...' : `Add Expense · $${finalTotal.toFixed(2)}`}
          </Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  form: { paddingHorizontal: 20 },
  label: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 18 },
  sectionHint: { fontSize: 12, color: '#aaa', marginBottom: 10, marginTop: 2 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 12,
    padding: 14, fontSize: 15, backgroundColor: '#fafafa', marginBottom: 4,
  },
  dollar: { fontSize: 16, color: '#999', fontWeight: '600' },

  // ── Mode selector ──
  modeBtn: {
    width: 90, borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 14, padding: 12, alignItems: 'center',
    backgroundColor: '#fafafa', gap: 3, marginRight: 8,
  },
  modeBtnActive: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  modeEmoji: { fontSize: 18 },
  modeBtnText: { fontSize: 12, fontWeight: '700', color: '#999' },
  modeBtnTextActive: { color: '#1DB954' },
  modeBtnSub: { fontSize: 10, color: '#bbb', textAlign: 'center' },

  // ── Equal mode ──
  memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  memberTile: {
    width: '30%', borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 14, padding: 12, alignItems: 'center', gap: 6,
    backgroundColor: '#fafafa',
  },
  memberTileActive: { borderColor: '#1DB954', backgroundColor: '#f0fdf4' },
  tileAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#ddd', justifyContent: 'center', alignItems: 'center',
  },
  tileAvatarActive: { backgroundColor: '#1DB954' },
  tileAvatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  tileName: { fontSize: 12, fontWeight: '600', color: '#aaa', textAlign: 'center' },

  // ── Remaining bar ──
  remainingBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, borderRadius: 10, marginBottom: 12,
  },
  remainingText: { fontSize: 13, fontWeight: '600' },

  // ── Exact mode ──
  exactRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, marginBottom: 10,
    backgroundColor: '#f9f9f9', borderRadius: 12, padding: 12,
  },
  exactAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center' },
  exactAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  exactName: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
  calcAmt: { fontSize: 12, color: '#1DB954', fontWeight: '600', marginTop: 2 },
  exactInputBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, paddingHorizontal: 10,
    backgroundColor: '#fff', width: 90,
  },
  exactInput: { flex: 1, padding: 10, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },

  // ── Percentage mode ──
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
    borderRadius: 10, paddingHorizontal: 10,
    backgroundColor: '#fff', width: 80,
  },
  pctSign: { fontSize: 15, color: '#1DB954', fontWeight: '700' },

  // ── Shares mode ──
  sharesBadge: {
    backgroundColor: '#f0f8ff', borderRadius: 10,
    padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#90caf9',
    alignItems: 'center',
  },
  sharesBadgeText: { fontSize: 13, color: '#1565c0', fontWeight: '600' },
  sharesBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1DB954',
    borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#fff',
  },
  sharesBtn: {
    width: 32, height: 40, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#e8f9ee',
  },
  sharesBtnText: { fontSize: 20, color: '#1DB954', fontWeight: '700' },
  sharesInput: {
    width: 40, textAlign: 'center',
    fontSize: 16, fontWeight: '700', color: '#1a1a1a', padding: 8,
  },

  // ── Items mode ──
  itemCard: { backgroundColor: '#f9f9f9', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#f0f0f0' },
  itemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 },
  priceBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 10, backgroundColor: '#fff', width: 90 },
  priceInput: { flex: 1, padding: 12, fontSize: 15, color: '#1a1a1a' },
  assignBtn: { borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, backgroundColor: '#fff' },
  assignBtnSplit: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  assignBtnPerson: { borderColor: '#1a1a1a', backgroundColor: '#1a1a1a' },
  assignBtnText: { fontSize: 12, color: '#999', fontWeight: '600' },
  assignBtnTextSplit: { color: '#1DB954' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderWidth: 1.5, borderColor: '#1DB954', borderRadius: 12, marginVertical: 8, gap: 8, borderStyle: 'dashed' },
  addItemText: { color: '#1DB954', fontSize: 15, fontWeight: '600' },

  // ── Summary box ──
  summaryBox: { backgroundColor: '#f0fdf4', borderRadius: 14, padding: 16, marginTop: 12, borderWidth: 1.5, borderColor: '#bbf7d0' },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  summaryAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center' },
  summaryAvatarText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  summaryName: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  summaryAmt: { fontSize: 17, fontWeight: '800', color: '#e53935' },

  // ── Who paid ──
  paidChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 24, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, backgroundColor: '#fafafa' },
  paidChipSelected: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  paidAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#ccc', justifyContent: 'center', alignItems: 'center' },
  paidAvatarSelected: { backgroundColor: '#1DB954' },
  paidAvatarText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  paidName: { fontSize: 13, color: '#555', fontWeight: '500' },

  // ── Save ──
  saveBtn: { backgroundColor: '#1DB954', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  saveBtnDisabled: { backgroundColor: '#ccc' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
