import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SpreadsheetEditor } from './SpreadsheetEditor'
import { saveText, type FileItem } from '../lib/files'
vi.mock('../lib/files', () => ({ saveText: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const item: FileItem = { id:'budget', name:'budget.csv', folder:'Finance', kind:'file', size:100, version:3, created:'2026-10-15T00:00:00Z',updated:'2026-10-15T00:00:00Z',deleted:null,author_id:'u',author:'Producer',updated_by:'Producer' }
it('preserves cells after a conflicting save and uses the original version', async () => {
  vi.mocked(saveText).mockRejectedValue(new Error('Someone saved a newer version.'))
  render(<SpreadsheetEditor spaceId="festival" item={item} text={'Type,Currency,Planned,Actual,Variance\r\nExpense,USD,100,125,\r\n'} onClose={vi.fn()} onSaved={vi.fn()}/>)
  fireEvent.change(screen.getByLabelText('Row 2, Actual'), { target:{value:'150'} })
  fireEvent.click(screen.getByRole('button',{name:'Save spreadsheet'}))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Row 2, Actual')).toHaveValue('150')
  expect(saveText).toHaveBeenCalledWith('festival','budget',expect.stringContaining('Expense,USD,100,150,50.00'),3)
})
it('saves an added row, reports the saved version and updates the caller', async () => {
  vi.mocked(saveText).mockResolvedValue({...item,version:4})
  const onSaved=vi.fn()
  render(<SpreadsheetEditor spaceId="festival" item={item} text={'Film ID,Title\r\n'} onClose={vi.fn()} onSaved={onSaved}/>)
  fireEvent.click(screen.getByRole('button',{name:'Add row'}))
  fireEvent.change(screen.getByLabelText('Row 2, Film ID'),{target:{value:'FILM-0001'}})
  fireEvent.change(screen.getByLabelText('Row 2, Title'),{target:{value:'A, Film'}})
  fireEvent.click(screen.getByRole('button',{name:'Save spreadsheet'}))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({version:4}),'Film ID,Title\r\nFILM-0001,"A, Film"\r\n'))
  expect(screen.getByRole('status')).toHaveTextContent('Saved version 4')
})
