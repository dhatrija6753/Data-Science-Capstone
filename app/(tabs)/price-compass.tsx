import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import {
  compareCartAcrossStores,
  ItemComparisonResult,
  TripComparisonResult,
  ALL_STORES,
  StoreId,
} from '../../lib/stores'
import { categorizeItems } from '../../lib/categorizer'

export default function PriceCompassScreen() {
  const { billId } = useLocalSearchParams()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [billDesc, setBillDesc] = useState('')
  const [storeName, setStoreName] = useState<string | null>(null)
  const [hasCompared, setHasCompared] = useState(false)

  const [itemResults, setItemResults] = useState<ItemComparisonResult[]>([])
  const [storeRanking, setStoreRanking] = useState<TripComparisonResult[]>([])
  const [totalPaid, setTotalPaid] = useState(0)

  const [selectedStores, setSelectedStores] = useState<StoreId[]>(
    ALL_STORES.map(s => s.id)
  )

  useEffect(() => { loadBillItems() }, [billId])

  async function loadBillItems() {
    setLoading(true)
    const { data: bill } = await supabase
      .from('bills')
      .select('description, store_name, total_amount')
      .eq('id', billId)
      .single()

    setBillDesc(bill?.store_name || bill?.description || 'Receipt')
    setStoreName(bill?.store_name || null)
    setTotalPaid(bill?.total_amount || 0)

    const { data: billItems } = await supabase
      .from('bill_items')
      .select('*')
      .eq('bill_id', billId)

    setItems(billItems || [])
    setLoading(false)
  }

  async function runComparison() {
    if (items.length === 0) {
      Alert.alert('No items', 'This bill has no scanned items to compare.')
      return
    }
    setComparing(true)
    try {
      // Step 1: Categorize items using AI
      const itemNames = items.map(i => i.name)
      const categories = await categorizeItems(itemNames)

      const categorizedItems = items.map(item => ({
        name: item.name,
        total_price: item.total_price,
        category: categories[item.name] || item.category || 'other',
      }))

      // Step 2: Compare across all selected stores
      const { itemResults: results, storeRanking: ranking, totalPaid: paid } =
        await compareCartAcrossStores(
          categorizedItems,
          storeName,
          selectedStores.length > 0 ? selectedStores : undefined
        )

      setItemResults(results)
      setStoreRanking(ranking)
      setTotalPaid(paid)
      setHasCompared(true)
    } catch (error) {
      Alert.alert('Error', 'Could not complete price comparison. Try again.')
      console.log('Comparison error:', error)
    }
    setComparing(false)
  }

  function toggleStore(id: StoreId) {
    setSelectedStores(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
    </View>
  )

  const bestStore = storeRanking[0]
  const worstStore = storeRanking[storeRanking.length - 1]

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 80 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.title}>🧭 Price Compass</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.subtitle}>
        Comparing {items.length} items from <Text style={{ fontWeight: '600', color: '#1a1a1a' }}>{billDesc}</Text>
      </Text>

      {/* Store Filter Chips */}
      <Text style={styles.sectionLabel}>Select stores to compare:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeChips}>
        {ALL_STORES.map(store => {
          const active = selectedStores.includes(store.id)
          return (
            <TouchableOpacity
              key={store.id}
              style={[styles.storeChip, active && { backgroundColor: store.color }]}
              onPress={() => toggleStore(store.id)}
            >
              <Text style={[styles.storeChipText, active && { color: '#fff' }]}>
                {store.emoji} {store.name}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {!hasCompared ? (
        /* ── PRE-COMPARE ── */
        <View style={styles.preCompare}>
          <View style={styles.itemPreviewBox}>
            <Text style={styles.itemPreviewTitle}>
              {items.length} items to compare
            </Text>
            {items.slice(0, 6).map((item, i) => (
              <View key={i} style={styles.itemPreviewRow}>
                <Ionicons name="cart-outline" size={15} color="#999" />
                <Text style={styles.itemPreviewName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.itemPreviewPrice}>${item.total_price?.toFixed(2)}</Text>
              </View>
            ))}
            {items.length > 6 && (
              <Text style={styles.moreItems}>+{items.length - 6} more items</Text>
            )}
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color="#1DB954" />
            <Text style={styles.infoText}>
              Real prices from Kroger API · Estimated prices for other stores using DMV market data
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.compareBtn, selectedStores.length === 0 && styles.btnDisabled]}
            onPress={runComparison}
            disabled={comparing || selectedStores.length === 0}
          >
            {comparing ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.compareBtnText}>Comparing prices...</Text>
              </View>
            ) : (
              <View style={styles.row}>
                <Ionicons name="search" size={20} color="#fff" />
                <Text style={styles.compareBtnText}>
                  Compare at {selectedStores.length} stores
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        /* ── RESULTS ── */
        <View>

          {/* Best deal banner */}
          {bestStore && (
            <View style={[styles.banner, { backgroundColor: bestStore.savingsVsPaid >= 0 ? '#1DB954' : '#e53935' }]}>
              <Text style={styles.bannerEmoji}>{bestStore.storeEmoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>
                  {bestStore.savingsVsPaid >= 0
                    ? `Best deal: ${bestStore.storeName}`
                    : `You got the best price! 🎉`}
                </Text>
                <Text style={styles.bannerSub}>
                  {bestStore.savingsVsPaid >= 0
                    ? `Save $${bestStore.savingsVsPaid.toFixed(2)} vs what you paid`
                    : `${bestStore.storeName} is already the cheapest option`}
                </Text>
              </View>
              <Text style={styles.bannerPrice}>${bestStore.totalCost.toFixed(2)}</Text>
            </View>
          )}

          {/* ── STORE RANKING ── */}
          <Text style={styles.sectionHeader}>🏆 Store Ranking — Full Cart</Text>
          <Text style={styles.sectionSubheader}>You paid: ${totalPaid.toFixed(2)}</Text>

          {storeRanking.map((store, i) => {
            const isBest = i === 0
            const savings = store.savingsVsPaid
            const barWidth = storeRanking.length > 1
              ? ((storeRanking[storeRanking.length - 1].totalCost - store.totalCost) /
                (storeRanking[storeRanking.length - 1].totalCost - storeRanking[0].totalCost + 0.01)) * 100
              : 50

            return (
              <View
                key={store.storeId}
                style={[styles.rankCard, isBest && styles.rankCardBest]}
              >
                <View style={styles.rankLeft}>
                  <Text style={styles.rankNum}>#{store.rank}</Text>
                  <Text style={styles.rankEmoji}>{store.storeEmoji}</Text>
                  <View>
                    <Text style={[styles.rankName, isBest && { color: '#1DB954' }]}>
                      {store.storeName}
                    </Text>
                    <View style={styles.rankBar}>
                      <View
                        style={[
                          styles.rankBarFill,
                          {
                            width: `${Math.max(10, barWidth)}%` as any,
                            backgroundColor: isBest ? '#1DB954' : '#e0e0e0',
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
                <View style={styles.rankRight}>
                  <Text style={[styles.rankPrice, isBest && { color: '#1DB954' }]}>
                    ${store.totalCost.toFixed(2)}
                  </Text>
                  {savings > 0 && (
                    <Text style={styles.rankSavings}>-${savings.toFixed(2)}</Text>
                  )}
                  {savings < 0 && (
                    <Text style={styles.rankPricier}>+${Math.abs(savings).toFixed(2)}</Text>
                  )}
                  {savings === 0 && (
                    <Text style={styles.rankSame}>same</Text>
                  )}
                </View>
              </View>
            )
          })}

          {/* ── ITEM BREAKDOWN ── */}
          <Text style={styles.sectionHeader}>📋 Item Breakdown</Text>

          {itemResults.map((result, index) => {
            const cheapestPrice = result.cheapestPrice
            const paidDiff = result.paidPrice - cheapestPrice

            return (
              <View key={index} style={styles.itemCard}>

                {/* Item Header */}
                <View style={styles.itemCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemCardName} numberOfLines={1}>
                      {result.itemName}
                    </Text>
                    <Text style={styles.itemCardCategory}>
                      {result.category}  ·  You paid: ${result.paidPrice.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.itemCardRight}>
                    {paidDiff > 0.05 ? (
                      <View style={styles.savePill}>
                        <Text style={styles.savePillText}>Save ${paidDiff.toFixed(2)}</Text>
                      </View>
                    ) : (
                      <View style={styles.goodPill}>
                        <Text style={styles.goodPillText}>Best price ✓</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* All stores — always visible */}
                <View style={styles.storeGrid}>
                  {result.storePrices
                    .sort((a, b) => a.price - b.price)
                    .map((sp) => {
                      const isCheapest = sp.store.id === result.cheapestStore
                      const diff = result.paidPrice - sp.price
                      return (
                        <View
                          key={sp.store.id}
                          style={[styles.storeGridRow, isCheapest && styles.storeGridRowBest]}
                        >
                          <Text style={styles.storeGridEmoji}>{sp.store.emoji}</Text>
                          <Text style={[styles.storeGridName, isCheapest && { color: '#1DB954', fontWeight: '700' }]}>
                            {sp.store.name}
                          </Text>
                          {sp.isOnSale && (
                            <View style={styles.salePill}>
                              <Text style={styles.salePillText}>SALE</Text>
                            </View>
                          )}
                          {sp.isEstimated && (
                            <Text style={styles.estLabel}>est.</Text>
                          )}
                          {isCheapest && (
                            <View style={styles.cheapestBadge}>
                              <Text style={styles.cheapestBadgeText}>cheapest</Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }} />
                          <Text style={[styles.storeGridPrice, isCheapest && { color: '#1DB954' }]}>
                            ${sp.price.toFixed(2)}
                          </Text>
                          {diff > 0.05 && (
                            <Text style={styles.diffSave}> -${diff.toFixed(2)}</Text>
                          )}
                          {diff < -0.05 && (
                            <Text style={styles.diffMore}> +${Math.abs(diff).toFixed(2)}</Text>
                          )}
                        </View>
                      )
                    })}
                </View>
              </View>
            )
          })}

          {/* Model note */}
          <View style={styles.modelNote}>
            <Ionicons name="flask-outline" size={14} color="#999" />
            <Text style={styles.modelNoteText}>
              "est." prices are modeled using DMV-area store price indices calibrated per category. Kroger/HT prices are live from the Kroger API.
            </Text>
          </View>

          <TouchableOpacity style={styles.recompareBtn} onPress={() => {
            setHasCompared(false)
            setItemResults([])
            setStoreRanking([])
          }}>
            <Text style={styles.recompareBtnText}>🔄 Re-run Comparison</Text>
          </TouchableOpacity>
        </View>
      )}
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
  title: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#999', paddingHorizontal: 20, marginBottom: 12 },

  sectionLabel: {
    fontSize: 13, color: '#666', fontWeight: '600',
    paddingHorizontal: 20, marginBottom: 8,
  },
  sectionHeader: {
    fontSize: 16, fontWeight: '700', color: '#1a1a1a',
    paddingHorizontal: 16, marginTop: 24, marginBottom: 4,
  },
  sectionSubheader: {
    fontSize: 13, color: '#999', paddingHorizontal: 16, marginBottom: 12,
  },

  storeChips: { paddingHorizontal: 16, marginBottom: 16 },
  storeChip: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 8, backgroundColor: '#fafafa',
  },
  storeChipText: { fontSize: 13, color: '#555', fontWeight: '500' },

  preCompare: { padding: 16 },
  itemPreviewBox: {
    backgroundColor: '#f9f9f9', borderRadius: 14, padding: 16, marginBottom: 12,
  },
  itemPreviewTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 10 },
  itemPreviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7,
  },
  itemPreviewName: { flex: 1, fontSize: 14, color: '#555' },
  itemPreviewPrice: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  moreItems: { fontSize: 13, color: '#999', marginTop: 4 },

  infoBox: {
    flexDirection: 'row', gap: 8, backgroundColor: '#e8f9ee',
    borderRadius: 12, padding: 12, marginBottom: 20, alignItems: 'flex-start',
  },
  infoText: { flex: 1, fontSize: 13, color: '#2e7d32', lineHeight: 18 },

  compareBtn: {
    backgroundColor: '#1DB954', padding: 16, borderRadius: 12, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#ccc' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compareBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  banner: {
    flexDirection: 'row', alignItems: 'center', margin: 16,
    padding: 16, borderRadius: 16, gap: 12,
  },
  bannerEmoji: { fontSize: 28 },
  bannerTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  bannerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  bannerPrice: { color: '#fff', fontWeight: '800', fontSize: 22 },

  rankCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#f9f9f9', borderRadius: 12, padding: 12,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  rankCardBest: { borderColor: '#1DB954', backgroundColor: '#f0fdf4' },
  rankLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankNum: { fontSize: 13, fontWeight: '700', color: '#999', width: 22 },
  rankEmoji: { fontSize: 20 },
  rankName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  rankBar: {
    height: 4, backgroundColor: '#e0e0e0', borderRadius: 2,
    marginTop: 5, width: 100, overflow: 'hidden',
  },
  rankBarFill: { height: 4, borderRadius: 2 },
  rankRight: { alignItems: 'flex-end', minWidth: 70 },
  rankPrice: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  rankSavings: { fontSize: 12, color: '#1DB954', fontWeight: '600', marginTop: 2 },
  rankPricier: { fontSize: 12, color: '#e53935', marginTop: 2 },
  rankSame: { fontSize: 12, color: '#999', marginTop: 2 },

  itemCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#f9f9f9', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#f0f0f0',
  },
  itemCardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  itemCardName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  itemCardCategory: { fontSize: 12, color: '#999', marginTop: 2 },
  itemCardRight: { alignItems: 'flex-end', gap: 2 },
  savePill: {
    backgroundColor: '#e8f9ee', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  savePillText: { fontSize: 12, color: '#1DB954', fontWeight: '600' },
  goodPill: {
    backgroundColor: '#fff3e0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  goodPillText: { fontSize: 12, color: '#e65100', fontWeight: '600' },

  storeGrid: { marginTop: 10, gap: 4 },
  storeGridRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 8, padding: 8, gap: 6,
  },
  storeGridRowBest: { backgroundColor: '#e8f9ee' },
  storeGridEmoji: { fontSize: 16, width: 24 },
  storeGridName: { fontSize: 13, color: '#333' },
  salePill: { backgroundColor: '#e8f9ee', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  salePillText: { fontSize: 10, color: '#1DB954', fontWeight: 'bold' },
  estLabel: { fontSize: 11, color: '#bbb', fontStyle: 'italic' },
  cheapestBadge: { backgroundColor: '#e8f9ee', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  cheapestBadgeText: { fontSize: 10, color: '#1DB954', fontWeight: '700' },
  storeGridPrice: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  diffSave: { fontSize: 12, color: '#1DB954', fontWeight: '600' },
  diffMore: { fontSize: 12, color: '#e53935' },

  modelNote: {
    flexDirection: 'row', gap: 6, margin: 16, marginTop: 8,
    backgroundColor: '#fafafa', borderRadius: 10, padding: 12, alignItems: 'flex-start',
  },
  modelNoteText: { flex: 1, fontSize: 12, color: '#aaa', lineHeight: 17 },

  recompareBtn: {
    margin: 16, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12,
  },
  recompareBtnText: { fontSize: 15, color: '#555' },
})
