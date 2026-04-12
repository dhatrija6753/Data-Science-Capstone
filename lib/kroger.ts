const KROGER_BASE_URL = 'https://api.kroger.com/v1'
const CLIENT_ID = process.env.EXPO_PUBLIC_KROGER_CLIENT_ID
const CLIENT_SECRET = process.env.EXPO_PUBLIC_KROGER_CLIENT_SECRET

// DMV area zip codes
const DMV_ZIPS = ['20001', '20850', '22201', '20904', '22030']

let accessToken: string | null = null
let tokenExpiry: number = 0

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken

  const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const response = await fetch(`${KROGER_BASE_URL}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=product.compact'
  })

  const data = await response.json()
  console.log('Kroger token response:', data)
  accessToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000
  return accessToken!
}

async function getNearbyStoreId(zipCode: string): Promise<string | null> {
  const token = await getAccessToken()
  const response = await fetch(
    `${KROGER_BASE_URL}/locations?filter.zipCode.near=${zipCode}&filter.radiusInMiles=15&filter.limit=1`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
  )
  const data = await response.json()
  console.log('Nearby store:', data.data?.[0]?.name)
  return data.data?.[0]?.locationId || null
}

export interface KrogerPrice {
  productName: string
  price: number | null
  regularPrice: number | null
  onSale: boolean
  storeName: string
  savings: number
}

export async function searchKrogerPrice(
  itemName: string,
  userPaidPrice: number,
  zipCode: string = '20001'
): Promise<KrogerPrice | null> {
  try {
    const token = await getAccessToken()
    const locationId = await getNearbyStoreId(zipCode)
    if (!locationId) return null

    // Clean item name for better search results
    const searchTerm = itemName
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(' ')
      .filter(w => w.length > 2)
      .slice(0, 3)
      .join(' ')
      .trim()

    console.log('Searching Kroger for:', searchTerm)

    const response = await fetch(
      `${KROGER_BASE_URL}/products?filter.term=${encodeURIComponent(searchTerm)}&filter.locationId=${locationId}&filter.limit=1`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
    )

    const data = await response.json()
    const product = data.data?.[0]
    if (!product) return null

    const priceInfo = product.items?.[0]?.price
    const krogerPrice = priceInfo?.promo || priceInfo?.regular || null
    const regularPrice = priceInfo?.regular || null

    return {
      productName: product.description,
      price: krogerPrice,
      regularPrice,
      onSale: !!(priceInfo?.promo && priceInfo.promo < priceInfo.regular),
      storeName: 'Harris Teeter / Kroger',
      savings: krogerPrice ? parseFloat((userPaidPrice - krogerPrice).toFixed(2)) : 0
    }
  } catch (error: any) {
    console.error('Kroger search error:', error?.message)
    return null
  }
}

export async function compareAllItems(
  items: { name: string, total_price: number }[],
  zipCode: string = '20001'
): Promise<{ itemName: string, paidPrice: number, kroger: KrogerPrice | null }[]> {
  const results = []

  for (const item of items.slice(0, 8)) { // Limit to 8 items to avoid rate limits
    const kroger = await searchKrogerPrice(item.name, item.total_price, zipCode)
    results.push({
      itemName: item.name,
      paidPrice: item.total_price,
      kroger
    })
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300))
  }

  return results
}