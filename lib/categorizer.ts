import Groq from 'groq-sdk'

const groq = new Groq({
  apiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY!,
  dangerouslyAllowBrowser: true,
})

export type ItemCategory =
  | 'produce'
  | 'dairy'
  | 'meat_seafood'
  | 'bakery'
  | 'beverages'
  | 'snacks'
  | 'frozen'
  | 'household'
  | 'personal_care'
  | 'alcohol'
  | 'pharmacy'
  | 'deli'
  | 'pantry'
  | 'other'

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  produce: '🥦 Produce',
  dairy: '🥛 Dairy',
  meat_seafood: '🥩 Meat & Seafood',
  bakery: '🍞 Bakery',
  beverages: '🥤 Beverages',
  snacks: '🍿 Snacks',
  frozen: '🧊 Frozen',
  household: '🧹 Household',
  personal_care: '🧴 Personal Care',
  alcohol: '🍺 Alcohol',
  pharmacy: '💊 Pharmacy',
  deli: '🥙 Deli',
  pantry: '🥫 Pantry',
  other: '📦 Other',
}

export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  produce: '#4CAF50',
  dairy: '#2196F3',
  meat_seafood: '#F44336',
  bakery: '#FF9800',
  beverages: '#00BCD4',
  snacks: '#9C27B0',
  frozen: '#03A9F4',
  household: '#795548',
  personal_care: '#E91E63',
  alcohol: '#FF5722',
  pharmacy: '#009688',
  deli: '#FFC107',
  pantry: '#8BC34A',
  other: '#9E9E9E',
}

// Keyword-based fallback classifier (no API needed)
const KEYWORD_MAP: Partial<Record<ItemCategory, string[]>> = {
  produce: ['apple', 'banana', 'orange', 'grape', 'strawberry', 'blueberry', 'lettuce', 'spinach', 'kale', 'tomato', 'onion', 'garlic', 'pepper', 'broccoli', 'carrot', 'celery', 'cucumber', 'avocado', 'lemon', 'lime', 'mango', 'peach', 'berry', 'veggie', 'vegetable', 'fruit', 'salad', 'herb', 'cilantro', 'parsley', 'mushroom', 'zucchini', 'squash', 'corn', 'potato', 'sweet potato'],
  dairy: ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'eggs', 'sour cream', 'cottage', 'mozzarella', 'cheddar', 'parmesan', 'brie', 'half & half', 'whipped cream', 'creamer'],
  meat_seafood: ['chicken', 'beef', 'pork', 'turkey', 'salmon', 'tuna', 'shrimp', 'fish', 'steak', 'ground', 'sausage', 'bacon', 'ham', 'lamb', 'tilapia', 'cod', 'lobster', 'crab', 'scallop'],
  bakery: ['bread', 'bagel', 'muffin', 'donut', 'croissant', 'roll', 'bun', 'cake', 'pie', 'cookie', 'brownie', 'pastry', 'baguette', 'tortilla', 'pita'],
  beverages: ['water', 'juice', 'soda', 'coffee', 'tea', 'drink', 'gatorade', 'lemonade', 'sparkling', 'kombucha', 'smoothie', 'milk tea', 'energy drink', 'coconut water', 'almond milk', 'oat milk', 'soy milk'],
  snacks: ['chip', 'pretzel', 'popcorn', 'cracker', 'granola', 'protein bar', 'trail mix', 'nuts', 'almond', 'cashew', 'peanut', 'candy', 'chocolate', 'gummy', 'marshmallow', 'rice cake'],
  frozen: ['frozen', 'ice cream', 'popsicle', 'gelato', 'sorbet', 'pizza', 'burrito', 'nugget', 'waffle', 'pancake mix'],
  household: ['detergent', 'soap', 'dish', 'paper towel', 'toilet paper', 'trash bag', 'laundry', 'bleach', 'cleaner', 'sponge', 'foil', 'plastic wrap', 'zip lock', 'storage bag', 'napkin'],
  personal_care: ['shampoo', 'conditioner', 'body wash', 'lotion', 'toothpaste', 'deodorant', 'razor', 'sunscreen', 'face wash', 'makeup', 'moisturizer', 'lip', 'mascara', 'cologne', 'perfume'],
  alcohol: ['beer', 'wine', 'vodka', 'whiskey', 'rum', 'tequila', 'gin', 'hard', 'cider', 'ale', 'lager', 'champagne', 'prosecco', 'seltzer', 'truly', 'white claw'],
  pharmacy: ['vitamin', 'medicine', 'aspirin', 'ibuprofen', 'tylenol', 'advil', 'allergy', 'bandage', 'supplement', 'melatonin', 'probiotic', 'fiber', 'antacid', 'cold medicine'],
  deli: ['deli', 'prepared', 'rotisserie', 'hot', 'soup', 'sub', 'sandwich', 'salad bar', 'sushi'],
  pantry: ['pasta', 'rice', 'cereal', 'oat', 'flour', 'sugar', 'salt', 'pepper', 'sauce', 'salsa', 'ketchup', 'mustard', 'mayo', 'olive oil', 'oil', 'vinegar', 'honey', 'syrup', 'jam', 'peanut butter', 'canned', 'bean', 'lentil', 'spice', 'seasoning', 'broth', 'stock'],
}

function keywordFallback(itemName: string): ItemCategory {
  const lower = itemName.toLowerCase()
  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords!.some(kw => lower.includes(kw))) {
      return category as ItemCategory
    }
  }
  return 'other'
}

// Batch categorize multiple items using Groq AI
export async function categorizeItems(
  items: string[]
): Promise<Record<string, ItemCategory>> {
  if (items.length === 0) return {}

  const prompt = `You are a grocery item classifier. Categorize each item into exactly one category.

Items:
${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Valid categories (use exactly these strings):
produce, dairy, meat_seafood, bakery, beverages, snacks, frozen, household, personal_care, alcohol, pharmacy, deli, pantry, other

Rules:
- produce = fresh fruits and vegetables
- dairy = milk, cheese, yogurt, eggs, butter, cream
- meat_seafood = all fresh/packaged meat and fish
- bakery = bread, pastries, desserts
- beverages = non-alcoholic drinks (include plant milks here)
- snacks = chips, candy, nuts, bars, crackers
- frozen = frozen meals, ice cream, frozen vegetables
- household = cleaning, paper goods, trash bags, laundry
- personal_care = shampoo, soap, skincare, cosmetics
- alcohol = beer, wine, spirits, hard seltzer
- pharmacy = medicines, vitamins, supplements, bandages
- deli = prepared/hot foods, rotisserie
- pantry = canned goods, pasta, rice, oils, spices, condiments, sauces
- other = anything that doesn't fit above

Respond with ONLY a valid JSON object. Example:
{"Organic Bananas": "produce", "2% Milk Gallon": "dairy", "Tide Pods": "household"}`

  try {
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500,
    })

    const result = JSON.parse(response.choices[0].message.content || '{}')

    // Validate and clean results
    const cleaned: Record<string, ItemCategory> = {}
    for (const item of items) {
      const found = result[item] as ItemCategory
      const validCategories = Object.keys(CATEGORY_LABELS) as ItemCategory[]
      if (found && validCategories.includes(found)) {
        cleaned[item] = found
      } else {
        // Try keyword fallback for any item Groq missed or got wrong
        cleaned[item] = keywordFallback(item)
      }
    }
    return cleaned
  } catch (error) {
    console.log('Groq categorizer error, using keyword fallback:', error)
    // Full keyword fallback
    return Object.fromEntries(
      items.map(item => [item, keywordFallback(item)])
    )
  }
}

// Summarize spending by category from a list of categorized items
export function summarizeByCategory(
  items: { name: string; total_price: number; category?: string }[]
): { category: ItemCategory; total: number; count: number; percentage: number }[] {
  const totals: Record<string, { total: number; count: number }> = {}
  const grandTotal = items.reduce((s, i) => s + i.total_price, 0)

  for (const item of items) {
    const cat = (item.category as ItemCategory) || 'other'
    if (!totals[cat]) totals[cat] = { total: 0, count: 0 }
    totals[cat].total += item.total_price
    totals[cat].count += 1
  }

  return Object.entries(totals)
    .map(([category, data]) => ({
      category: category as ItemCategory,
      total: parseFloat(data.total.toFixed(2)),
      count: data.count,
      percentage: grandTotal > 0 ? Math.round((data.total / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
}
