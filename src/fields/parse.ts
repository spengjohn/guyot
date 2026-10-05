import type { Money, PayPeriod } from '../data/types/fields'

/** Lines to list items: trimmed, blank lines dropped. */
export function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export interface MoneyParts {
  amount: string
  period: PayPeriod
  currency: string
}

/** The money the parts describe, or what's still missing. An empty amount means none. */
export function moneyFrom(parts: MoneyParts): { value: Money | null; problem?: string } {
  if (parts.amount.trim() === '') return { value: null }
  const amount = Number(parts.amount)
  if (!Number.isFinite(amount) || amount < 0) {
    return { value: null, problem: 'Enter the amount as a number, such as 85000' }
  }
  const currency = parts.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { value: null, problem: 'Enter a three-letter currency code, such as USD' }
  }
  return { value: { amount, period: parts.period, currency } }
}
