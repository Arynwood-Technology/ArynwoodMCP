import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceSetup } from './WorkspaceSetup'
import { api } from '../lib/community'
vi.mock('../lib/community', () => ({api:vi.fn()}))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const kit={kit:'film-festival',name:'Independent film festival',description:'Producer operations',root:'Festival Operations',lists:17,items:120,notes:8,tasks:4,folders:32,files:24,spreadsheets:16,events:0,departments:['Submissions intake'],trackers:['Festival Operations/Finance/budget.csv']}
it('requires preview before applying and leaves unconfirmed dates unset', async () => {
  vi.mocked(api).mockImplementation(async(_path,method) => method === 'POST' ? kit : {kits:[kit],installed:[]})
  render(<MemoryRouter><WorkspaceSetup space={{id:'festival',name:'RogueFest',role:'owner'}}/></MemoryRouter>)
  expect(screen.queryByRole('button',{name:'Stage RogueFest workspace'})).toBeNull()
  fireEvent.click(await screen.findByRole('button',{name:'Preview setup'}))
  const apply=await screen.findByRole('button',{name:'Stage RogueFest workspace'})
  expect(api).toHaveBeenCalledWith('/community/spaces/festival/workspace-setup/preview','POST',{kit:'film-festival',client:'RogueFest',opening_date:null})
  fireEvent.click(apply)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('RogueFest is staged'))
  expect(screen.getByRole('link',{name:'Open documents & trackers'})).toHaveAttribute('href','/community/files?folder=Festival%20Operations')
  expect(screen.queryByRole('button',{name:'Preview setup'})).toBeNull()
})
