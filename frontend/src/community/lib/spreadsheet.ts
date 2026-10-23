/** CSV tables only: formulas and macros are never evaluated. Rows come padded to the same width.
 *  `separator` is a tab for TSV. */
export function readCSV(text: string, separator = ','): string[][] {
  const rows: string[][] = [], row: string[] = []
  let value = '', quoted = false, closed = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { value += '"'; i++ } else { quoted = false; closed = true }
      } else value += c
    } else if (c === separator) { row.push(value); value = ''; closed = false }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && source[i + 1] === '\n') i++
      row.push(value); rows.push([...row]); row.length = 0; value = ''; closed = false
    } else if (c === '"' && value === '' && !closed) quoted = true
    else {
      if (closed || c === '"') throw new Error('This CSV has malformed quotes. Open the source editor to correct it.')
      value += c
    }
  }
  if (quoted) throw new Error('This CSV has an unclosed quoted cell. Open the source editor to correct it.')
  if (value || row.length || closed) { row.push(value); rows.push([...row]) }
  if (!rows.length) rows.push(['Column 1'])
  const width = rows.reduce((most, r) => Math.max(most, r.length), 0)
  return rows.map(r => r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r)
}
/** A CSV for the table editor, which keeps to a size it can show. */
export function parseCSV(text: string): string[][] {
  const rows = readCSV(text), width = rows[0].length
  if (rows.length > 1001 || width > 40 || rows.length * width > 20000) throw new Error('The table editor supports 1,000 data rows, 40 columns and 20,000 cells. Download this file or use the source editor for larger tables.')
  return rows
}
export function writeCSV(rows: string[][]): string {
  return rows.map(row => row.map(cell => /[",\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell).join(',')).join('\r\n') + '\r\n'
}

export function amount(value: string): number | null {
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}
export const money = (cents: number) => (cents / 100).toFixed(2)
const column = (headers: string[], name: string) => headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase())
export function budgetColumns(headers: string[]) {
  const cols = Object.fromEntries(['Type','Currency','Planned','Actual','Variance'].map(name => [name.toLowerCase(), column(headers, name)]))
  return ['type','currency','planned','actual'].every(name => cols[name] >= 0) ? cols : null
}
export function budgetSummary(rows: string[][]) {
  const cols = budgetColumns(rows[0]), currencies: Record<string, { plannedIncome: number; actualIncome: number; plannedExpense: number; actualExpense: number }> = {}
  const errors: string[] = []
  if (!cols) return { currencies, errors }
  rows.slice(1).forEach((row, i) => {
    if (row.every(cell => !cell.trim())) return
    const type = row[cols.type].trim().toLowerCase(), currency = row[cols.currency].trim().toUpperCase()
    if (!['expense','income'].includes(type)) { errors.push(`Row ${i + 2}: Type must be Expense or Income.`); return }
    if (!currency) { errors.push(`Row ${i + 2}: Enter a Currency before including this row in totals.`); return }
    const planned = row[cols.planned].trim() ? amount(row[cols.planned]) : 0, actual = row[cols.actual].trim() ? amount(row[cols.actual]) : 0
    if (planned === null || actual === null) { errors.push(`Row ${i + 2}: Planned and Actual need plain numbers with at most two decimal places.`); return }
    const totals = currencies[currency] ??= { plannedIncome: 0, actualIncome: 0, plannedExpense: 0, actualExpense: 0 }
    if (type === 'income') { totals.plannedIncome += planned; totals.actualIncome += actual }
    else { totals.plannedExpense += planned; totals.actualExpense += actual }
  })
  return { currencies, errors }
}
export function withVariance(rows: string[][]): string[][] {
  const cols = budgetColumns(rows[0])
  if (!cols || cols.variance < 0) return rows
  return rows.map((row, index) => {
    if (index === 0) return row
    const copy = [...row], planned = amount(row[cols.planned]), actual = amount(row[cols.actual])
    copy[cols.variance] = planned !== null && actual !== null ? money(actual - planned) : ''
    return copy
  })
}
