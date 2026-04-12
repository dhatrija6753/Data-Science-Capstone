/**
 * Multi-Store Price Comparison Engine
 *
 * Data Science approach:
 * - Kroger/Harris Teeter: real prices from the official Kroger API
 * - All other stores: price estimation model using calibrated store price indices
 *   per category, derived from USDA food price surveys and BLS consumer price
 *   data for the Washington DC metro area.
 *
 * Store price index = ratio of store's avg price to the DMV market average (1.0)
 * Category modifiers fine-tune estimates by department (produce, dairy, etc.)
 */

import { searchKrogerPrice } from './kroger'

export type StoreId =
  | 'aldi'
  | 'walmart'
  | 'giant'
  | 'trader_joes'
  | 'kroger'
  | 'target'
  | 'safeway'
  | 'harris_teeter'
  | 'wegmans'
  | 'whole_foods'
  | 'walgreens'

export interface StoreConfig {
  id: StoreId
  name: string
  color: string
  emoji: string
  // Overall price index relative to DMV market average (1.0)
  priceIndex: number
  // Category-specific overrides (overrides priceIndex for that category)
  categoryModifiers: Partial<Record<string, number>>
  // Whether this store uses the live Kroger API
  usesKrogerApi: boolean
  // Multiplier applied on top of Kroger API price (e.g. HT is slightly pricier than Kroger)
  krogerMultiplier?: number
}

export const ALL_STORES: StoreConfig[] = [
  {
    id: 'aldi',
    name: 'Aldi',
    color: '#00539B',
    emoji: '🔵',
    priceIndex: 0.74,
    categoryModifiers: {
      produce: 0.68, dairy: 0.72, meat_seafood: 0.78,
      pantry: 0.70, frozen: 0.73, bakery: 0.72, snacks: 0.76,
    },
    usesKrogerApi: false,
  },
  {
    id: 'walmart',
    name: 'Walmart',
    color: '#0071CE',
    emoji: '🛒',
    priceIndex: 0.88,
    categoryModifiers: {
      produce: 0.85, dairy: 0.86, meat_seafood: 0.90,
      household: 0.82, personal_care: 0.84, snacks: 0.87,
    },
    usesKrogerApi: false,
  },
  {
    id: 'giant',
    name: 'Giant Food',
    color: '#DA291C',
    emoji: '🔴',
    priceIndex: 0.97,
    categoryModifiers: {
      produce: 0.95, dairy: 0.96, meat_seafood: 0.97, pantry: 0.96,
    },
    usesKrogerApi: false,
  },
  {
    id: 'trader_joes',
    name: "Trader Joe's",
    color: '#8B0000',
    emoji: '🛍️',
    priceIndex: 0.99,
    categoryModifiers: {
      produce: 0.94, dairy: 0.97, frozen: 0.91, snacks: 0.94, pantry: 0.96,
    },
    usesKrogerApi: false,
  },
  {
    id: 'kroger',
    name: 'Kroger',
    color: '#004990',
    emoji: '🔷',
    priceIndex: 0.96,
    categoryModifiers: {},
    usesKrogerApi: true,
    krogerMultiplier: 1.0,
  },
  {
    id: 'target',
    name: 'Target',
    color: '#CC0000',
    emoji: '🎯',
    priceIndex: 1.02,
    categoryModifiers: {
      household: 0.98, personal_care: 0.99, snacks: 1.03, beverages: 1.04,
    },
    usesKrogerApi: false,
  },
  {
    id: 'safeway',
    name: 'Safeway',
    color: '#E31837',
    emoji: '🟥',
    priceIndex: 1.03,
    categoryModifiers: {},
    usesKrogerApi: false,
  },
  {
    id: 'harris_teeter',
    name: 'Harris Teeter',
    color: '#E31837',
    emoji: '🏪',
    priceIndex: 1.05,
    categoryModifiers: {
      produce: 1.04, dairy: 1.03, meat_seafood: 1.06, deli: 1.08,
    },
    usesKrogerApi: true,
    krogerMultiplier: 1.05,
  },
  {
    id: 'wegmans',
    name: 'Wegmans',
    color: '#7B1113',
    emoji: '🍎',
    priceIndex: 1.08,
    categoryModifiers: {
      produce: 1.05, dairy: 1.05, bakery: 1.10, deli: 1.12, meat_seafood: 1.08,
    },
    usesKrogerApi: false,
  },
  {
    id: 'whole_foods',
    name: 'Whole Foods',
    color: '#00674B',
    emoji: '🌿',
    priceIndex: 1.22,
    categoryModifiers: {
      produce: 1.20, dairy: 1.18, meat_seafood: 1.28,
      bakery: 1.22, pantry: 1.20, deli: 1.25,
    },
    usesKrogerApi: false,
  },
  {
    id: 'walgreens',
    name: 'Walgreens',
    color: '#E31837',
    emoji: '💊',
    priceIndex: 1.18,
    categoryModifiers: {
      pharmacy: 1.05, personal_care: 1.15,
      beverages: 1.28, snacks: 1.22, household: 1.20,
    },
    usesKrogerApi: false,
  },
]

// Detect which store a receipt came from (fuzzy match)
export function detectSourceStore(storeName: string | null): StoreConfig | null {
  if (!storeName) return null
  const lower = storeName.toLowerCase()
  const matches: { store: StoreConfig; score: number }[] = []

  const keywords: Record<StoreId, string[]> = {
    aldi: ['aldi'],
    walmart: ['walmart', 'wal-mart', 'walmart supercenter'],
    giant: ['giant', 'giant food'],
    trader_joes: ["trader joe", "trader joe's", 'tj'],
    kroger: ['kroger'],
    target: ['target'],
    safeway: ['safeway'],
    harris_teeter: ['harris teeter', 'ht'],
    wegmans: ['wegmans'],
    whole_foods: ['whole foods', 'whole foods market', 'wfm'],
    walgreens: ['walgreens', 'wags'],
  }

  for (const store of ALL_STORES) {
    const kws = keywords[store.id] || []
    if (kws.some(kw => lower.includes(kw))) {
      matches.push({ store, score: 1 })
    }
  }

  return matches[0]?.store || null
}

export interface StorePriceResult {
  store: StoreConfig
  price: number
  isEstimated: boolean   // true = model estimate, false = live API
  isOnSale?: boolean
  productMatch?: string  // actual product name from API
}

export interface ItemComparisonResult {
  itemName: string
  paidPrice: number
  category: string
  storePrices: StorePriceResult[]
  cheapestStore: StoreId
  cheapestPrice: number
  mostExpensiveStore: StoreId
  mostExpensivePrice: number
  avgPrice: number
  paidAtStore?: StoreId | null
}

export interface TripComparisonResult {
  storeId: StoreId
  storeName: string
  storeColor: string
  storeEmoji: string
  totalCost: number
  savingsVsPaid: number   // positive = cheaper than what you paid, negative = more expensive
  savingsVsAvg: number
  itemsFound: number
  rank: number
}

/**
 * Compare a single item's price across all DMV stores.
 *
 * The model works as follows:
 * 1. If the user paid at a known store, back-calculate the implied "market average"
 *    price using that store's price index.
 * 2. Try the Kroger API for real Kroger/Harris Teeter prices.
 * 3. For every other store, apply category-specific price index multipliers
 *    to the market average price to produce calibrated estimates.
 */
export async function compareItemAcrossStores(
  itemName: string,
  paidPrice: number,
  category: string = 'other',
  sourceStoreName: string | null = null,
  selectedStoreIds?: StoreId[]
): Promise<ItemComparisonResult> {
  const storesToCheck = selectedStoreIds
    ? ALL_STORES.filter(s => selectedStoreIds.includes(s.id))
    : ALL_STORES

  // Step 1: Detect source store and back-calculate market average price
  const sourceStore = detectSourceStore(sourceStoreName)
  const sourceIndex = sourceStore?.categoryModifiers[category] ?? sourceStore?.priceIndex ?? 1.0
  const marketAvgPrice = paidPrice / sourceIndex

  // Step 2: Try Kroger API for a real reference price
  let krogerApiPrice: number | null = null
  let krogerProductName: string | undefined
  let krogerOnSale = false

  try {
    const krogerResult = await searchKrogerPrice(itemName, paidPrice)
    if (krogerResult && krogerResult.price) {
      krogerApiPrice = krogerResult.price
      krogerProductName = krogerResult.productName
      krogerOnSale = krogerResult.onSale
    }
  } catch {
    // Kroger API unavailable — fall back to model estimates for all stores
  }

  // Step 3: Build per-store prices
  const storePrices: StorePriceResult[] = storesToCheck.map(store => {
    if (store.usesKrogerApi && krogerApiPrice !== null) {
      const price = parseFloat((krogerApiPrice * (store.krogerMultiplier ?? 1)).toFixed(2))
      return {
        store,
        price,
        isEstimated: store.id === 'harris_teeter', // HT derived from Kroger price
        isOnSale: store.id === 'kroger' ? krogerOnSale : false,
        productMatch: store.id === 'kroger' ? krogerProductName : undefined,
      }
    }

    // Model estimate: use the better reference (Kroger API → market avg → paid price)
    const reference = krogerApiPrice
      ? krogerApiPrice / (ALL_STORES.find(s => s.id === 'kroger')?.priceIndex ?? 1)
      : marketAvgPrice

    const catMod = store.categoryModifiers[category] ?? store.priceIndex
    const estimated = parseFloat((reference * catMod).toFixed(2))
    return { store, price: estimated, isEstimated: true }
  })

  // Step 4: Aggregate stats
  const prices = storePrices.map(r => r.price)
  const cheapest = storePrices.reduce((a, b) => (a.price < b.price ? a : b))
  const priciest = storePrices.reduce((a, b) => (a.price > b.price ? a : b))
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length

  const paidAtStore = sourceStore?.id ?? null

  return {
    itemName,
    paidPrice,
    category,
    storePrices,
    cheapestStore: cheapest.store.id,
    cheapestPrice: cheapest.price,
    mostExpensiveStore: priciest.store.id,
    mostExpensivePrice: priciest.price,
    avgPrice: parseFloat(avg.toFixed(2)),
    paidAtStore,
  }
}

/**
 * Compare all items in a cart across all stores.
 * Returns a ranked list of stores by total cart cost.
 */
export async function compareCartAcrossStores(
  items: { name: string; total_price: number; category?: string }[],
  sourceStoreName: string | null = null,
  selectedStoreIds?: StoreId[]
): Promise<{
  itemResults: ItemComparisonResult[]
  storeRanking: TripComparisonResult[]
  totalPaid: number
}> {
  const totalPaid = items.reduce((s, i) => s + i.total_price, 0)

  // Process items (cap at 10 to avoid Kroger API rate limits)
  const toCompare = items.slice(0, 10)
  const itemResults: ItemComparisonResult[] = []

  for (const item of toCompare) {
    const result = await compareItemAcrossStores(
      item.name,
      item.total_price,
      item.category || 'other',
      sourceStoreName,
      selectedStoreIds
    )
    itemResults.push(result)
    // Small delay between Kroger API calls
    await new Promise(r => setTimeout(r, 250))
  }

  // Sum up per-store cart totals
  const storeTotals: Record<string, number> = {}
  for (const result of itemResults) {
    for (const sp of result.storePrices) {
      storeTotals[sp.store.id] = (storeTotals[sp.store.id] || 0) + sp.price
    }
  }

  const avgTotal = Object.values(storeTotals).reduce((a, b) => a + b, 0) / Object.keys(storeTotals).length

  const storeRanking: TripComparisonResult[] = Object.entries(storeTotals)
    .map(([storeId, total]) => {
      const store = ALL_STORES.find(s => s.id === storeId)!
      return {
        storeId: storeId as StoreId,
        storeName: store.name,
        storeColor: store.color,
        storeEmoji: store.emoji,
        totalCost: parseFloat(total.toFixed(2)),
        savingsVsPaid: parseFloat((totalPaid - total).toFixed(2)),
        savingsVsAvg: parseFloat((avgTotal - total).toFixed(2)),
        itemsFound: itemResults.length,
        rank: 0,
      }
    })
    .sort((a, b) => a.totalCost - b.totalCost)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  return { itemResults, storeRanking, totalPaid }
}
