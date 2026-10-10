import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Community } from './Community'
import { api } from './lib/community'
vi.mock('./lib/community',()=>({api:vi.fn()}))
vi.mock('./pages/DayPlanner',()=>({DayPlanner:()=> <div>Daily planner</div>}))
vi.mock('./pages/IRC',()=>({IRC:()=>null}))
vi.mock('./pages/P2PChat',()=>({P2PChat:()=>null}))
vi.mock('./pages/Mail',()=>({Mail:()=>null}))
const user={id:'owner',name:'Test owner',email:'owner@example.test',admin:0}
const home={id:'home',name:'Home',role:'owner'}
const team={id:'team',name:'Team',role:'owner'}
const mocked=vi.mocked(api)
beforeEach(()=>mocked.mockReset())
afterEach(()=>cleanup())
function show(url='/community'){render(<MemoryRouter initialEntries={[url]}><Community/></MemoryRouter>)}
it('creates and selects a space while preserving the existing space',async()=>{
 mocked.mockImplementation(async(path,method)=>path==='/auth/me'?user:path==='/community/spaces'&&method==='POST'?team:[home])
 show();await screen.findByRole('option',{name:'Home'})
 fireEvent.click(screen.getByRole('button',{name:'Create new space'}))
 fireEvent.change(screen.getByLabelText('Space name'),{target:{value:'  Team  '}})
 fireEvent.click(screen.getByRole('button',{name:'Create space'}))
 await screen.findByRole('option',{name:'Team'})
 expect(screen.getByRole('combobox')).toHaveValue('team')
 expect(screen.getByRole('option',{name:'Home'})).toBeInTheDocument()
 expect(mocked).toHaveBeenCalledWith('/community/spaces','POST',{name:'Team'})
})
it('creates an invitation only on request and copies its link',async()=>{
 mocked.mockImplementation(async(path)=>path==='/auth/me'?user:path==='/community/spaces'?[home]:{token:'fixture-invitation'})
 const copy=vi.fn().mockResolvedValue(undefined)
 Object.defineProperty(navigator,'clipboard',{value:{writeText:copy},configurable:true})
 show();await screen.findByRole('option',{name:'Home'})
 fireEvent.click(screen.getByRole('button',{name:'Invite members'}))
 expect(mocked).not.toHaveBeenCalledWith('/community/spaces/home/invites','POST')
 expect(screen.getByText(/opens only on this computer/)).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Create invitation link'}))
 expect(await screen.findByLabelText('Invite link')).toHaveValue(`${window.location.origin}/community?invite=fixture-invitation`)
 fireEvent.click(screen.getByRole('button',{name:'Copy link'}))
 await screen.findByRole('button',{name:'Copied'})
 expect(copy).toHaveBeenCalledWith(`${window.location.origin}/community?invite=fixture-invitation`)
})
it('invites through the server address when the Grove has one',async()=>{
 const url='https://grove.example.test/community?invite=fixture-invitation'
 mocked.mockImplementation(async(path)=>path==='/auth/me'?user:path==='/auth/status'?{setup:false,public_url:'https://grove.example.test'}:path==='/community/spaces'?[home]:{token:'fixture-invitation',url})
 show();await screen.findByRole('option',{name:'Home'})
 await screen.findByText(/grove\.example\.test\), shared live with your members/)
 fireEvent.click(screen.getByRole('button',{name:'Invite members'}))
 expect(screen.queryByText(/opens only on this computer/)).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Create invitation link'}))
 expect(await screen.findByLabelText('Invite link')).toHaveValue(url)
})
it('joins an invitation when already signed in and hides owner actions for members',async()=>{
 const joined={...team,role:'member'}
 mocked.mockImplementation(async(path)=>path==='/auth/me'?user:path==='/community/join'?joined:[home,joined])
 show('/community?invite=existing-member-fixture')
 await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('team'))
 expect(mocked).toHaveBeenCalledWith('/community/join','POST',{token:'existing-member-fixture'})
 expect(mocked.mock.calls.filter(([path])=>path==='/community/join')).toHaveLength(1)
 expect(screen.queryByRole('button',{name:'Invite members'})).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Create new space'})).toBeInTheDocument()
})
it('keeps spaces usable when an invitation has expired',async()=>{
 mocked.mockImplementation(async(path)=>{if(path==='/community/join')throw Error('Invite expired or unavailable.');return path==='/auth/me'?user:[home]})
 show('/community?invite=expired-fixture')
 await screen.findByRole('option',{name:'Home'})
 expect(screen.getByRole('alert')).toHaveTextContent('Invite expired or unavailable.')
})
