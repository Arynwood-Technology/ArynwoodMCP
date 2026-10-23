import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Community } from './Community'
import { defaultBrand } from './lib/brand'
import { api } from './lib/community'
vi.mock('./lib/community',()=>({api:vi.fn()}))
vi.mock('./pages/DayPlanner',()=>({DayPlanner:()=> <div>Daily planner</div>}))
vi.mock('./pages/IRC',()=>({IRC:()=>null}))
vi.mock('./pages/Mail',()=>({Mail:()=>null}))
const user={id:'owner',name:'Test owner',email:'owner@example.test',admin:0,role:'member',can_start_spaces:true}
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
it('shows the space topic and, to its owners, a way to manage the space',async()=>{
 mocked.mockImplementation(async(path)=>path==='/auth/me'?user:path==='/community/spaces'?[{...home,topic:'Sunday dinners'},{...team,role:'member'}]:[])
 show();expect(await screen.findByText('Sunday dinners')).toBeInTheDocument()
 expect(screen.getByRole('link',{name:'Manage space'})).toHaveAttribute('href','/community/settings')
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'team'}})
 expect(screen.queryByRole('link',{name:'Manage space'})).toBeNull()
 expect(screen.queryByText('Sunday dinners')).toBeNull()
})
it('gives the Grove admin page to owners and managers, the website to everyone, and the wish lamp to everyone',async()=>{
 mocked.mockImplementation(async(path)=>path==='/auth/me'?{...user,can_start_spaces:false}:[home])
 show();await screen.findByRole('option',{name:'Home'})
 expect(screen.queryByRole('link',{name:'Grove admin'})).toBeNull()
 expect(screen.queryByRole('link',{name:/^Webmaster tools/})).toBeNull()
 expect(screen.getByRole('link',{name:'Website preview See the website and leave notes'})).toHaveAttribute('href','/community/website')
 expect(screen.queryByRole('button',{name:'Create new space'})).toBeNull()
 expect(screen.getByRole('button',{name:'Make a wish'})).toBeInTheDocument()
 cleanup()
 show('/community/admin');expect(await screen.findByText(/Only this Grove’s owners and managers/)).toBeInTheDocument()
 cleanup()
 mocked.mockImplementation(async(path)=>path==='/auth/me'?{...user,role:'manager',webmaster:true}:[home])
 show();expect(await screen.findByRole('link',{name:'Grove admin'})).toHaveAttribute('href','/community/admin')
 expect(screen.getByRole('link',{name:'Webmaster tools Edit and publish the website'})).toHaveAttribute('href','/community/website')
})

it('uses the Grove identity and external links in the signed-in header',async()=>{
 const brand={...defaultBrand,branded:true,name:'Festival Friends',tagline:'Films and friends',site_url:'https://festival.example',shop_url:'https://shop.example',logo_url:'/api/brand/logo'}
 mocked.mockImplementation(async(path)=>path==='/brand'?brand:path==='/auth/me'?user:path==='/community/spaces'?[home]:{setup:false})
 show()
 expect(await screen.findByText('Films and friends')).toBeInTheDocument()
 expect(screen.getByText('Festival Friends')).toBeInTheDocument()
 expect(screen.getByRole('img',{name:'Festival Friends'})).toHaveAttribute('src','/api/community/grove/brand/logo')
 expect(screen.getByRole('link',{name:'Website'})).toHaveAttribute('href','https://festival.example')
 expect(screen.getByRole('link',{name:'Shop'})).toHaveAttribute('href','https://shop.example')
 expect(screen.queryByText(/community\.arynwood\.com/)).toBeNull()
 // Inside Arynwood the window keeps the app's own title.
 expect(document.title).not.toBe('Festival Friends')
})
it('opens Public chat to members only when the Grove has a room, and names the log after the Grove',async()=>{
 Element.prototype.scrollIntoView=vi.fn()  // jsdom has none; the log scrolls to its newest update
 mocked.mockImplementation(async(path)=>path==='/auth/me'?user:[home])
 show();await screen.findByRole('option',{name:'Home'})
 expect(screen.queryByRole('link',{name:'Public chat'})).toBeNull()
 expect(screen.getByRole('link',{name:'Updates'})).toHaveAttribute('href','/community/discussion')
 cleanup()
 const festival={...user,public_chat:{channel:'#RogueFest',nick:'RogueGuest###',server:'irc.arynwood.com'},log_name:"Event journal"}
 mocked.mockImplementation(async(path)=>path==='/auth/me'?festival:[home])
 show('/community/discussion');await screen.findByRole('option',{name:'Home'})
 expect(screen.getByRole('link',{name:'Public chat'})).toHaveAttribute('href','/community/irc')
 expect(screen.getByRole('link',{name:"Event journal"})).toHaveAttribute('href','/community/discussion')
 expect(screen.getByText(/Event journal is where news and updates for everyone in this space go\. For conversation, use Public chat\./)).toBeInTheDocument()
})
it('groups the menu into talking, organizing and settings, and slides it over the page from its button',async()=>{
 const festival={...user,role:'owner',public_chat:{channel:'#RogueFest',nick:'RogueGuest###',server:'irc.arynwood.com'},log_name:'Event journal'}
 mocked.mockImplementation(async(path)=>path==='/auth/me'?festival:[home])
 const {container}=render(<MemoryRouter initialEntries={['/community/lists']}><Community/></MemoryRouter>)
 await screen.findByRole('option',{name:'Home'})
 const groups=[...screen.getByRole('navigation',{name:'Community sections'}).querySelectorAll('.nav-group')].map(g=>[g.querySelector('.nav-caption')!.textContent,[...g.querySelectorAll('a')].map(a=>a.textContent)])
 expect(groups).toEqual([['Talk',['Public chat','Messages','Event journal','Board']],['Organize',['Overview','Calendar','Tasks','Lists','Notes','Files']],
  ['Settings',['People & identity','Grove admin','Look & feel','Workspace setup']]])
 expect(screen.getByRole('link',{name:'Lists'})).toHaveClass('active')
 // On a phone the menu waits behind its button; picking a page or pressing Escape puts it away.
 const shell=container.querySelector('.grove-shell')!
 expect(within(container.querySelector('.shell-topbar') as HTMLElement).getByText('Lists')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Open menu'}))
 expect(shell).toHaveClass('menu-open')
 expect(screen.getByRole('button',{name:'Close menu'})).toHaveFocus()
 fireEvent.click(screen.getByRole('link',{name:'Notes'}))
 expect(shell).not.toHaveClass('menu-open')
 fireEvent.click(screen.getByRole('button',{name:'Open menu'}))
 fireEvent.keyDown(document,{key:'Escape'})
 expect(shell).not.toHaveClass('menu-open')
 cleanup()
 // The site editor has the whole width; its menu is behind the button there too.
 const editor=render(<MemoryRouter initialEntries={['/community/website?site=home&folder=Website%2Fsite&mode=edit']}><Community/></MemoryRouter>)
 await screen.findByRole('option',{name:'Home'})
 expect(editor.container.querySelector('.grove-shell')).toHaveClass('focus')
})
