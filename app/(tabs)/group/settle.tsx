import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { calculateGroupBalances, simplifyDebts, SimplifiedDebt } from '../../../lib/debt-calculator'

export default function SettleScreen() {
  const { id } = useLocalSearchParams()
  const router = useRouter()
  const [debts, setDebts] = useState<SimplifiedDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [groupName, setGroupName] = useState('')

  useEffect(() => { loadDebts() }, [id])

  async function loadDebts() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    setCurrentUser(user)

    const { data: group } = await supabase
      .from('groups').select('name').eq('id', id).single()
    setGroupName(group?.name || '')

    const { data: members } = await supabase
      .from('group_members')
      .select('*, profiles(id, full_name)')
      .eq('group_id', id)

    if (!members) { setLoading(false); return }

    const balances = await calculateGroupBalances(id as string, members, supabase)
    const simplified = simplifyDebts(balances)
    setDebts(simplified)
    setLoading(false)
  }

  async function settleDebt(debt: SimplifiedDebt) {
    Alert.alert(
      'Confirm Settlement',
      `Mark that ${debt.fromName} paid ${debt.toName} $${debt.amount.toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Settled!',
          onPress: async () => {
            setSettling(`${debt.fromUserId}-${debt.toUserId}`)
            const { error } = await supabase.from('settlements').insert({
              group_id: id,
              from_user: debt.fromUserId,
              to_user: debt.toUserId,
              amount: debt.amount,
              note: 'Settled via app'
            })
            if (error) Alert.alert('Error', error.message)
            else await loadDebts()
            setSettling(null)
          }
        }
      ]
    )
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
    </View>
  )

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.title}>Settle Up</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.groupName}>{groupName}</Text>

      {debts.length === 0 ? (
        <View style={styles.allSettled}>
          <Ionicons name="checkmark-circle" size={80} color="#1DB954" />
          <Text style={styles.allSettledTitle}>All Settled Up! 🎉</Text>
          <Text style={styles.allSettledSubtitle}>No outstanding debts in this group</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>
            {debts.length} payment{debts.length > 1 ? 's' : ''} needed to settle up
          </Text>

          {debts.map((debt, index) => {
            const isMyDebt = debt.fromUserId === currentUser?.id
            const isSettling = settling === `${debt.fromUserId}-${debt.toUserId}`

            return (
              <View key={index} style={[styles.debtCard, isMyDebt && styles.myDebtCard]}>
                <View style={styles.debtTop}>
                  <View style={styles.personBox}>
                    <View style={[styles.avatar, isMyDebt && styles.myAvatar]}>
                      <Text style={styles.avatarText}>{debt.fromName[0].toUpperCase()}</Text>
                    </View>
                    <Text style={styles.personName} numberOfLines={1}>{debt.fromName}</Text>
                  </View>

                  <View style={styles.arrowBox}>
                    <Text style={styles.amount}>${debt.amount.toFixed(2)}</Text>
                    <Ionicons name="arrow-forward" size={20} color="#1DB954" />
                  </View>

                  <View style={styles.personBox}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{debt.toName[0].toUpperCase()}</Text>
                    </View>
                    <Text style={styles.personName} numberOfLines={1}>{debt.toName}</Text>
                  </View>
                </View>

                {isMyDebt && (
                  <TouchableOpacity
                    style={styles.settleBtn}
                    onPress={() => settleDebt(debt)}
                    disabled={!!settling}
                  >
                    {isSettling ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                        <Text style={styles.settleBtnText}>I paid this</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {!isMyDebt && (
                  <Text style={styles.waitingText}>
                    Waiting for {debt.fromName} to settle
                  </Text>
                )}
              </View>
            )
          })}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  groupName: { fontSize: 15, color: '#999', textAlign: 'center', marginBottom: 24 },
  sectionLabel: { fontSize: 14, color: '#999', paddingHorizontal: 20, marginBottom: 12 },
  allSettled: { alignItems: 'center', paddingTop: 80, gap: 12 },
  allSettledTitle: { fontSize: 24, fontWeight: 'bold', color: '#1a1a1a' },
  allSettledSubtitle: { fontSize: 15, color: '#999' },
  debtCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: '#f9f9f9', borderRadius: 16, padding: 16 },
  myDebtCard: { backgroundColor: '#fff5f5', borderWidth: 1.5, borderColor: '#ffcccc' },
  debtTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  personBox: { alignItems: 'center', width: 80 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  myAvatar: { backgroundColor: '#e53935' },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  personName: { fontSize: 13, color: '#333', fontWeight: '500', textAlign: 'center' },
  arrowBox: { alignItems: 'center', gap: 4 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#1DB954' },
  settleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1DB954', padding: 12, borderRadius: 10, gap: 6 },
  settleBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  waitingText: { fontSize: 13, color: '#999', textAlign: 'center', fontStyle: 'italic' }
})