import { describe, expect, it } from 'vitest'
import { linesToList, moneyFrom } from './parse'

describe('linesToList', () => {
  it('makes one item per line, trimmed, without blank lines', () => {
    expect(linesToList('  UX designer \n\nResearch\n   \n')).toEqual(['UX designer', 'Research'])
    expect(linesToList('')).toEqual([])
  })
})

describe('moneyFrom', () => {
  const parts = { amount: '85000', period: 'year' as const, currency: 'usd' }

  it('reads an amount, period and currency', () => {
    expect(moneyFrom(parts)).toEqual({ value: { amount: 85000, period: 'year', currency: 'USD' } })
  })

  it('treats an empty amount as no minimum', () => {
    expect(moneyFrom({ ...parts, amount: ' ' })).toEqual({ value: null })
  })

  it('reports what is still wrong', () => {
    expect(moneyFrom({ ...parts, amount: '-5' }).problem).toMatch(/amount/)
    expect(moneyFrom({ ...parts, currency: 'dollars' }).problem).toMatch(/currency code/)
  })
})
