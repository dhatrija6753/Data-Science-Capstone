import Groq from 'groq-sdk'

const groq = new Groq({
  apiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY,
  dangerouslyAllowBrowser: true
})

export interface ExtractedItem {
  name: string
  quantity: number
  unit_price: number
  total_price: number
}

export interface ExtractedReceipt {
  store_name: string | null
  date: string | null
  items: ExtractedItem[]
  subtotal: number | null
  tax: number | null
  tip: number | null
  total: number
}

export async function extractReceiptFromImage(imageBase64: string): Promise<ExtractedReceipt> {
  console.log('Sending to Groq, image size:', imageBase64.length)

  const prompt = `You are a receipt parser. Extract all purchased line items from this receipt image.

Return ONLY valid JSON, no explanation, no markdown, just raw JSON:

{
  "store_name": "string or null",
  "date": "YYYY-MM-DD or null",
  "items": [
    {
      "name": "clean human-readable product name",
      "quantity": 1,
      "unit_price": 0.00,
      "total_price": 0.00
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": null,
  "total": 0.00
}

Rules:
1. NEVER include subtotal, tax, tip, or total as line items
2. If quantity not shown, use 1
3. All prices are plain numbers in dollars like 4.99 not "$4.99"
4. Expand abbreviations: "ORG 2% MLK" becomes "Organic 2% Milk"
5. If a value is missing use null
6. total must always be a number`

  try {
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    })

    const text = response.choices[0]?.message?.content || ''
    console.log('Groq response:', text.substring(0, 300))

    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    const parsed = JSON.parse(cleaned)
    console.log('Items extracted:', parsed.items?.length)
    return parsed

  } catch (error: any) {
    console.error('Groq error:', error?.message)
    throw error
  }
}