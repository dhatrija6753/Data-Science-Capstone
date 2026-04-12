export interface NetBalance {
  userId: string
  name: string
  amount: number  // positive = owed money, negative = owes money
}

export interface SimplifiedDebt {
  fromUserId: string
  fromName: string
  toUserId: string
  toName: string
  amount: number
}

export function simplifyDebts(balances: NetBalance[]): SimplifiedDebt[] {
  const creditors = balances
    .filter(b => b.amount > 0.01)
    .map(b => ({ ...b }))
    .sort((a, b) => b.amount - a.amount)

  const debtors = balances
    .filter(b => b.amount < -0.01)
    .map(b => ({ ...b, amount: Math.abs(b.amount) }))
    .sort((a, b) => b.amount - a.amount)

  const transactions: SimplifiedDebt[] = []
  let i = 0, j = 0

  while (i < creditors.length && j < debtors.length) {
    const payment = Math.min(creditors[i].amount, debtors[j].amount)

    transactions.push({
      fromUserId: debtors[j].userId,
      fromName: debtors[j].name,
      toUserId: creditors[i].userId,
      toName: creditors[i].name,
      amount: parseFloat(payment.toFixed(2))
    })

    creditors[i].amount -= payment
    debtors[j].amount -= payment

    if (creditors[i].amount < 0.01) i++
    if (debtors[j].amount < 0.01) j++
  }

  return transactions
}

export async function calculateGroupBalances(
  groupId: string,
  members: any[],
  supabase: any
): Promise<NetBalance[]> {
  const balances: Record<string, number> = {}
  const names: Record<string, string> = {}

  // Initialize all members with 0 balance
  members.forEach((m: any) => {
    balances[m.profiles.id] = 0
    names[m.profiles.id] = m.profiles.full_name
  })

  // Fetch all bills
  const { data: bills } = await supabase
    .from('bills')
    .select('*')
    .eq('group_id', groupId)

  for (const bill of bills || []) {
    // Person who paid gets credit
    if (balances[bill.paid_by] !== undefined) {
      balances[bill.paid_by] += bill.total_amount
    }

    // Each person owes their split
    const { data: splits } = await supabase
      .from('bill_splits')
      .select('*')
      .eq('bill_id', bill.id)

    splits?.forEach((split: any) => {
      if (balances[split.user_id] !== undefined) {
        balances[split.user_id] -= split.amount_owed
      }
    })
  }

  // Fetch settlements and apply them
  const { data: settlements } = await supabase
    .from('settlements')
    .select('*')
    .eq('group_id', groupId)

  settlements?.forEach((s: any) => {
    if (balances[s.from_user] !== undefined) balances[s.from_user] += s.amount
    if (balances[s.to_user] !== undefined) balances[s.to_user] -= s.amount
  })

  return Object.entries(balances).map(([userId, amount]) => ({
    userId,
    name: names[userId] || 'Unknown',
    amount: parseFloat(amount.toFixed(2))
  }))
}