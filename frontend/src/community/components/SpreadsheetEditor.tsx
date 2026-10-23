import { useEffect, useRef, useState } from 'react'
import { budgetColumns, budgetSummary, money, parseCSV, withVariance, writeCSV } from '../lib/spreadsheet'
import { saveText, type FileItem } from '../lib/files'
import { Modal } from '../pages/Workspace'
import './spreadsheet.css'

export function SpreadsheetEditor({ spaceId, item, text, onClose, onSaved }: { spaceId: string; item: FileItem; text: string; onClose: () => void; onSaved: (item: FileItem, text: string) => void }) {
  const [parsed] = useState(() => { try { return { rows: parseCSV(text), error: '' } } catch (e) { return { rows: [['']], error: (e as Error).message } } })
  const [rows, setRows] = useState(parsed.rows), [saved, setSaved] = useState(writeCSV(parsed.rows)), [version, setVersion] = useState(item.version)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const saving = useRef(false)
  const dirty = writeCSV(rows) !== saved, totals = budgetSummary(rows), cols = budgetColumns(rows[0])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function close() { if (!saving.current && (!dirty || window.confirm('Discard your unsaved spreadsheet changes?'))) onClose() }
  function cell(r: number, c: number, value: string) { setRows(current => current.map((row, i) => i === r ? row.map((v, j) => j === c ? value : v) : row)); setMessage('') }
  async function save() {
    if (saving.current || !dirty || parsed.error) return
    saving.current = true; setBusy(true); setError(''); setMessage('')
    const snapshot = withVariance(rows), contents = writeCSV(snapshot)
    try {
      const result = await saveText(spaceId, item.id, contents, version)
      setRows(snapshot); setSaved(contents); setVersion(result.version); onSaved(result, contents); setMessage(`Saved version ${result.version}.`)
    } catch (e) { setError((e as Error).message) } finally { saving.current = false; setBusy(false) }
  }
  return <Modal title={`${item.name} — spreadsheet`} onClose={close}>
    <div className="spreadsheet-editor"><p>Version {version} · {rows.length - 1} data rows{dirty ? ' · Unsaved changes' : ''}. CSV table; formulas remain text.</p>
      {parsed.error ? <p className="error" role="alert">{parsed.error}</p> : <>
        <div className="sheet-scroll" tabIndex={0} role="region" aria-label="Spreadsheet table"><table><thead><tr><th scope="col">Row</th>{rows[0].map((header, c) => <th scope="col" key={c}><input aria-label={`Column ${c + 1} heading`} value={header} disabled={busy} onChange={e => cell(0,c,e.target.value)}/></th>)}<th scope="col">Actions</th></tr></thead><tbody>
          {withVariance(rows).slice(1).map((row, r) => <tr key={r}><th scope="row">{r + 2}</th>{row.map((value, c) => <td key={c}><textarea rows={2} aria-label={`Row ${r + 2}, ${rows[0][c] || `column ${c + 1}`}`} value={value} disabled={busy} readOnly={cols?.variance === c} onChange={e => cell(r+1,c,e.target.value)}/></td>)}<td><button type="button" className="text-button danger" disabled={busy} onClick={() => { if (row.every(v => !v) || window.confirm(`Remove row ${r + 2}? Save to keep this change.`)) setRows(current => current.filter((_,i) => i !== r + 1)) }}>Remove row {r + 2}</button></td></tr>)}
        </tbody></table></div>
        <div className="action-row"><button className="secondary" disabled={busy || rows.length >= 1001 || (rows.length + 1) * rows[0].length > 20000} onClick={() => setRows(current => [...current, current[0].map(() => '')])}>Add row</button><button className="secondary" disabled={busy || rows[0].length >= 40 || rows.length * (rows[0].length + 1) > 20000} onClick={() => setRows(current => current.map((row,i) => [...row, i ? '' : `Column ${row.length + 1}`]))}>Add column</button><button className="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save spreadsheet'}</button></div>
        {cols && <section><h3>Budget totals by currency</h3><p className="muted-text">Blank amounts are not entered. Variance is Actual minus Planned; a positive expense variance means an overrun. Net is income minus expenses. Invalid rows are excluded from totals.</p>{Object.entries(totals.currencies).map(([currency,t]) => <div key={currency}><h4>{currency}</h4><table className="budget-totals"><thead><tr><th scope="col">Measure</th><th scope="col">Planned</th><th scope="col">Actual</th></tr></thead><tbody><tr><th scope="row">Income</th><td>{money(t.plannedIncome)}</td><td>{money(t.actualIncome)}</td></tr><tr><th scope="row">Expenses</th><td>{money(t.plannedExpense)}</td><td>{money(t.actualExpense)}</td></tr><tr><th scope="row">Net</th><td>{money(t.plannedIncome-t.plannedExpense)}</td><td>{money(t.actualIncome-t.actualExpense)}</td></tr></tbody></table></div>)}{!Object.keys(totals.currencies).length && <p>Enter a Type, Currency and amounts to see totals.</p>}{totals.errors.length > 0 && <ul className="error" aria-label="Budget validation">{totals.errors.map(e => <li key={e}>{e}</li>)}</ul>}</section>}
      </>}
      {error && <p className="error" role="alert">{error} Your unsaved cells remain available to copy.</p>}{message && <p role="status">{message}</p>}
      <button className="secondary" disabled={busy} onClick={close}>Close spreadsheet</button>
    </div>
  </Modal>
}
