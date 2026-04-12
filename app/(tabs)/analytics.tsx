import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import {
  categorizeItems,
  summarizeByCategory,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  ItemCategory,
} from '../../lib/categorizer'

interface SpendingCategory {
  category: ItemCategory
  total: number
  count: number
  percentage: number
}

interface MonthlySpend {
  month: string
  total: number
}

interface GroupSpend {
  groupName: string
  total: number
  billCount: number
}

interface SmartTip {
  icon: string
  title: string
  description: string
  color: string
}

export default function AnalyticsScreen() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [totalSpent, setTotalSpent] = useState(0)
  const [billCount, setBillCount] = useState(0)
  const [categoryBreakdown, setCategoryBreakdown] = useState<SpendingCategory[]>([])
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpend[]>([])
  const [groupSpend, setGroupSpend] = useState<GroupSpend[]>([])
  const [smartTips, setSmartTips] = useState<SmartTip[]>([])
  const [avgBillSize, setAvgBillSize] = useState(0)
  const [topStore, setTopStore] = useState<string>('')

  useFocusEffect(
    useCallback(() => {
      loadAnalytics()
    }, [])
  )

  async function loadAnalytics() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    await Promise.all([
      loadSpendingData(user.id),
    ])
    setLoading(false)
  }

  async function loadSpendingData(userId: string) {
    // 1. Get all bills where the user paid or is a member
    const { data: splits } = await supabase
      .from('bill_splits')
      .select(`
        amount_owed,
        bills (
          id, total_amount, description, store_name, bill_date,
          groups ( name )
        )
      `)
      .eq('user_id', userId)

    if (!splits || splits.length === 0) {
      setLoading(false)
      return
    }

    const bills = splits.map((s: any) => ({
      ...s.bills,
      myShare: s.amount_owed,
    })).filter(Boolean)

    // Total spent (my share across all bills)
    const total = bills.reduce((sum: number, b: any) => sum + (b.myShare || 0), 0)
    setTotalSpent(parseFloat(total.toFixed(2)))
    setBillCount(bills.length)
    setAvgBillSize(bills.length > 0 ? parseFloat((total / bills.length).toFixed(2)) : 0)

    // Top store
    const storeCounts: Record<string, number> = {}
    bills.forEach((b: any) => {
      const store = b.store_name || b.description || 'Unknown'
      storeCounts[store] = (storeCounts[store] || 0) + 1
    })
    const topStoreName = Object.entries(storeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    setTopStore(topStoreName)

    // Monthly spend (last 6 months)
    const monthMap: Record<string, number> = {}
    bills.forEach((b: any) => {
      if (!b.bill_date) return
      const month = b.bill_date.slice(0, 7) // YYYY-MM
      monthMap[month] = (monthMap[month] || 0) + (b.myShare || 0)
    })
    const months = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, total]) => ({
        month: new Date(month + '-01').toLocaleString('default', { month: 'short' }),
        total: parseFloat(total.toFixed(2)),
      }))
    setMonthlySpend(months)

    // Group spend breakdown
    const groupMap: Record<string, { total: number; count: number }> = {}
    bills.forEach((b: any) => {
      const name = b.groups?.name || 'Other'
      if (!groupMap[name]) groupMap[name] = { total: 0, count: 0 }
      groupMap[name].total += b.myShare || 0
      groupMap[name].count += 1
    })
    setGroupSpend(
      Object.entries(groupMap)
        .map(([groupName, d]) => ({
          groupName,
          total: parseFloat(d.total.toFixed(2)),
          billCount: d.count,
        }))
        .sort((a, b) => b.total - a.total)
    )

    // Item category breakdown (load bill items and categorize them)
    const billIds = bills.map((b: any) => b.id).filter(Boolean)
    if (billIds.length > 0) {
      const { data: billItems } = await supabase
        .from('bill_items')
        .select('name, total_price, category')
        .in('bill_id', billIds)

      if (billItems && billItems.length > 0) {
        // Categorize any uncategorized items
        const uncategorized = billItems.filter(i => !i.category || i.category === 'other')
        if (uncategorized.length > 0) {
          const names = uncategorized.map(i => i.name)
          const aiCategories = await categorizeItems(names)
          billItems.forEach(item => {
            if (!item.category || item.category === 'other') {
              item.category = aiCategories[item.name] || 'other'
            }
          })
        }

        const breakdown = summarizeByCategory(billItems)
        setCategoryBreakdown(breakdown)

        // Generate smart tips based on top categories
        generateSmartTips(breakdown, bills, total)
      }
    }
  }

  function generateSmartTips(
    breakdown: SpendingCategory[],
    bills: any[],
    total: number
  ) {
    const tips: SmartTip[] = []
    const topCat = breakdown[0]

    if (topCat) {
      const label = CATEGORY_LABELS[topCat.category].split(' ').slice(1).join(' ')
      tips.push({
        icon: CATEGORY_LABELS[topCat.category].split(' ')[0],
        title: `${label} is your #1 spend`,
        description: `${topCat.percentage}% of your grocery spending goes to ${label.toLowerCase()}. Aldi and Walmart have the best ${label.toLowerCase()} prices in the DMV.`,
        color: CATEGORY_COLORS[topCat.category],
      })
    }

    if (total > 100) {
      tips.push({
        icon: '🧭',
        title: 'Use Price Compass more',
        description: `Based on your spending of $${total.toFixed(0)}, switching to cheaper stores for your cart could save you an estimated $${(total * 0.15).toFixed(0)}/month.`,
        color: '#1DB954',
      })
    }

    if (breakdown.find(b => b.category === 'household') && total > 50) {
      tips.push({
        icon: '🧹',
        title: 'Buy household items at Walmart',
        description: 'Walmart is typically 18% cheaper than Target and 22% cheaper than Whole Foods on household goods like cleaning supplies and paper products.',
        color: '#0071CE',
      })
    }

    if (breakdown.find(b => b.category === 'produce')) {
      tips.push({
        icon: '🥦',
        title: "Produce: Aldi beats everyone",
        description: "Aldi's produce is on average 32% cheaper than the DMV market rate. Giant Food is the best mid-range option for fresh produce.",
        color: '#4CAF50',
      })
    }

    setSmartTips(tips)
  }

  async function onRefresh() {
    setRefreshing(true)
    await loadAnalytics()
    setRefreshing(false)
  }

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
      <Text style={styles.loadingText}>Analyzing your spending...</Text>
    </View>
  )

  const maxMonthly = Math.max(...monthlySpend.map(m => m.total), 1)
  const maxGroup = Math.max(...groupSpend.map(g => g.total), 1)

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1DB954" />}
    >
      <Text style={styles.title}>Analytics</Text>
      <Text style={styles.subtitle}>Your spending insights</Text>

      {/* ── SUMMARY CARDS ── */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>${totalSpent.toFixed(0)}</Text>
          <Text style={styles.summaryLabel}>Total Spent</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{billCount}</Text>
          <Text style={styles.summaryLabel}>Bills Split</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>${avgBillSize}</Text>
          <Text style={styles.summaryLabel}>Avg Bill</Text>
        </View>
      </View>

      {topStore ? (
        <View style={styles.topStoreCard}>
          <Ionicons name="location" size={16} color="#1DB954" />
          <Text style={styles.topStoreText}>
            Most visited: <Text style={{ fontWeight: '700', color: '#1a1a1a' }}>{topStore}</Text>
          </Text>
        </View>
      ) : null}

      {/* ── MONTHLY SPEND CHART ── */}
      {monthlySpend.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📅 Monthly Spending</Text>
          <View style={styles.barChart}>
            {monthlySpend.map((m, i) => (
              <View key={i} style={styles.barColumn}>
                <Text style={styles.barValue}>${m.total.toFixed(0)}</Text>
                <View style={styles.barOuter}>
                  <View
                    style={[
                      styles.barFill,
                      { height: `${Math.max(6, (m.total / maxMonthly) * 100)}%` as any },
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{m.month}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── CATEGORY BREAKDOWN ── */}
      {categoryBreakdown.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏷️ Spending by Category</Text>
          <Text style={styles.sectionSub}>Powered by Groq AI classification</Text>

          {/* Visual bar breakdown */}
          <View style={styles.categoryChart}>
            {categoryBreakdown.map((cat, i) => (
              <View key={i} style={styles.catRow}>
                <Text style={styles.catEmoji}>
                  {CATEGORY_LABELS[cat.category].split(' ')[0]}
                </Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.catBarRow}>
                    <Text style={styles.catName}>
                      {CATEGORY_LABELS[cat.category].split(' ').slice(1).join(' ')}
                    </Text>
                    <Text style={styles.catTotal}>${cat.total.toFixed(2)}</Text>
                    <Text style={styles.catPct}>{cat.percentage}%</Text>
                  </View>
                  <View style={styles.catBarOuter}>
                    <View
                      style={[
                        styles.catBarFill,
                        {
                          width: `${cat.percentage}%` as any,
                          backgroundColor: CATEGORY_COLORS[cat.category],
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.emptySection}>
          <Ionicons name="bar-chart-outline" size={36} color="#ddd" />
          <Text style={styles.emptyText}>Scan bills to see category breakdown</Text>
        </View>
      )}

      {/* ── GROUP SPENDING ── */}
      {groupSpend.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👥 Spending by Group</Text>
          {groupSpend.map((g, i) => (
            <View key={i} style={styles.groupSpendRow}>
              <View style={styles.groupAvatar}>
                <Text style={styles.groupAvatarText}>{g.groupName[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupSpendName}>{g.groupName}</Text>
                <Text style={styles.groupSpendCount}>{g.billCount} bills</Text>
                <View style={styles.groupBarOuter}>
                  <View
                    style={[
                      styles.groupBarFill,
                      { width: `${(g.total / maxGroup) * 100}%` as any },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.groupSpendTotal}>${g.total.toFixed(2)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── SMART TIPS ── */}
      {smartTips.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💡 Smart Recommendations</Text>
          <Text style={styles.sectionSub}>Personalized based on your spending patterns</Text>
          {smartTips.map((tip, i) => (
            <View key={i} style={[styles.tipCard, { borderLeftColor: tip.color }]}>
              <Text style={styles.tipIcon}>{tip.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipDesc}>{tip.description}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── EMPTY STATE ── */}
      {billCount === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="analytics-outline" size={60} color="#ddd" />
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptyDesc}>
            Scan your first receipt and split a bill to see your spending analytics here.
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#999' },

  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a1a', paddingHorizontal: 20 },
  subtitle: { fontSize: 15, color: '#999', paddingHorizontal: 20, marginBottom: 20 },

  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 12 },
  summaryCard: {
    flex: 1, backgroundColor: '#f9f9f9', borderRadius: 14,
    padding: 14, alignItems: 'center',
  },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#1DB954' },
  summaryLabel: { fontSize: 12, color: '#999', marginTop: 2, textAlign: 'center' },

  topStoreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#e8f9ee', marginHorizontal: 16,
    borderRadius: 10, padding: 10, marginBottom: 8,
  },
  topStoreText: { fontSize: 14, color: '#555' },

  section: {
    marginHorizontal: 16, marginTop: 24,
    backgroundColor: '#f9f9f9', borderRadius: 16, padding: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  sectionSub: { fontSize: 12, color: '#aaa', marginBottom: 14 },

  // Monthly bar chart
  barChart: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 120, gap: 8, marginTop: 8,
  },
  barColumn: { flex: 1, alignItems: 'center', height: '100%' },
  barValue: { fontSize: 10, color: '#999', marginBottom: 4 },
  barOuter: {
    flex: 1, width: '100%', backgroundColor: '#e0e0e0',
    borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end',
  },
  barFill: { width: '100%', backgroundColor: '#1DB954', borderRadius: 4 },
  barLabel: { fontSize: 11, color: '#666', marginTop: 4 },

  // Category bars
  categoryChart: { gap: 12 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catEmoji: { fontSize: 20, width: 28 },
  catBarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  catName: { flex: 1, fontSize: 13, color: '#333', fontWeight: '500' },
  catTotal: { fontSize: 13, fontWeight: '700', color: '#1a1a1a', marginRight: 6 },
  catPct: { fontSize: 12, color: '#999', width: 32 },
  catBarOuter: {
    height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden',
  },
  catBarFill: { height: 6, borderRadius: 3 },

  // Group spending
  groupSpendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 14,
  },
  groupAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  groupAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  groupSpendName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  groupSpendCount: { fontSize: 12, color: '#999', marginBottom: 4 },
  groupBarOuter: {
    height: 5, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden',
  },
  groupBarFill: { height: 5, backgroundColor: '#1DB954', borderRadius: 3 },
  groupSpendTotal: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', minWidth: 60, textAlign: 'right' },

  // Smart tips
  tipCard: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: '#fff', borderRadius: 12,
    borderLeftWidth: 4, marginBottom: 10,
  },
  tipIcon: { fontSize: 24 },
  tipTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  tipDesc: { fontSize: 13, color: '#666', lineHeight: 18 },

  emptySection: {
    alignItems: 'center', padding: 32, gap: 8,
    marginHorizontal: 16, marginTop: 16,
  },
  emptyText: { fontSize: 14, color: '#bbb', textAlign: 'center' },

  emptyState: {
    alignItems: 'center', padding: 48, gap: 12,
    marginTop: 32,
  },
  emptyTitle: { fontSize: 20, fontWeight: 'bold', color: '#ccc' },
  emptyDesc: { fontSize: 14, color: '#bbb', textAlign: 'center', lineHeight: 20 },
})
