export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
  created_at: string
}

export interface Group {
  id: string
  name: string
  description: string | null
  created_by: string
  created_at: string
}

export interface Bill {
  id: string
  group_id: string
  paid_by: string
  description: string | null
  total_amount: number
  split_type: 'equal' | 'itemized' | 'percentage'
  created_at: string
}