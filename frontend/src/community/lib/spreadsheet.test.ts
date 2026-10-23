import { describe, expect, it } from 'vitest'
import { amount, budgetSummary, parseCSV, withVariance, writeCSV } from './spreadsheet'
describe('CSV and budget tables', () => {
  it('round trips quoted commas, quotes, multiline cells and blank trailing values', () => {
    const rows = [['Title','Notes','Status'],['A, film','Line 1\n"quote"',''],['B','\r\n','Ready']]
    expect(parseCSV('\uFEFF'+writeCSV(rows))).toEqual(rows)
    expect(parseCSV('A,B\r\nx,')).toEqual([['A','B'],['x','']])
    expect(parseCSV('A,B\n"",')).toEqual([['A','B'],['','']])
  })
  it('rejects malformed or oversized grids without evaluating formula text', () => {
    expect(() => parseCSV('A\n"oops')).toThrow('unclosed')
    expect(() => parseCSV('A\n"ok"oops')).toThrow('malformed')
    expect(() => parseCSV(Array(42).fill('a').join(','))).toThrow('40 columns')
    expect(parseCSV('Value\n=SUM(A1:A9)')[1][0]).toBe('=SUM(A1:A9)')
  })
  it('calculates cents and separates income, expenses and currencies', () => {
    const rows = [['Type','Currency','Planned','Actual','Variance'],['Expense','USD','0.10','0.20',''],['Expense','USD','0.20','0.30',''],['Income','USD','100','120',''],['Expense','EUR','50','',''],['Expense','','10','10',''],['Expense','USD','oops','1','']]
    const { currencies, errors } = budgetSummary(rows)
    expect(currencies.USD).toEqual({plannedIncome:10000,actualIncome:12000,plannedExpense:30,actualExpense:50})
    expect(currencies.EUR.plannedExpense).toBe(5000)
    expect(errors).toHaveLength(2)
    expect(withVariance(rows)[1][4]).toBe('0.10')
    expect(withVariance(rows)[4][4]).toBe('')
    expect(amount('1,000')).toBeNull()
    expect(amount('=1+2')).toBeNull()
    expect(amount('1.234')).toBeNull()
  })
})
