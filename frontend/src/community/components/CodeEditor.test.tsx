import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodeEditor } from './CodeEditor'
import { FileBank } from '../pages/FileBank'
import { api } from '../lib/community'
import type { FileItem } from '../lib/files'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
vi.mock('../lib/live', () => ({ useSpaceRefresh: () => {} }))
const mocked = vi.mocked(api)
const item: FileItem = { id:'page',folder:'Website/site.test',name:'index.html',kind:'file',size:100,version:1,created:'2026-10-14T10:00:00Z',updated:'2026-10-14T10:00:00Z',deleted:null,author_id:'host',author:'Host',updated_by:'Host' }
beforeEach(()=>{
 mocked.mockReset()
 mocked.mockImplementation(async(path,method)=>path.endsWith('/previews')?{url:'/api/community/preview/fixture/'}:method==='PUT'?{...item,version:2}:path.endsWith('/versions')?[{version:1,size:100,author:'Host',created:item.created}]:{})
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<h1>Before</h1>')))
 Object.defineProperties(Range.prototype, { getClientRects: { configurable:true,value:()=>[] }, getBoundingClientRect: { configurable:true,value:()=>new DOMRect() } })
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
function show(){const onClose=vi.fn(),onSaved=vi.fn();render(<CodeEditor spaceId="crew" item={item} text="<h1>Before</h1>" onClose={onClose} onSaved={onSaved}/>);return {onClose,onSaved}}
function change(value:string){const editor=EditorView.findFromDOM(screen.getByRole('textbox',{name:'File contents'}))!;act(()=>editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:value}}));return editor}

it('saves with the loaded version and uses the returned version next time',async()=>{
 const {onSaved}=show()
 change('<h1>After</h1>')
 fireEvent.click(screen.getByRole('button',{name:'Save'}))
 expect(await screen.findByRole('status')).toHaveTextContent('Saved version 2.')
 expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/files/page/text','PUT',{text:'<h1>After</h1>',version:1})
 expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({version:2}),'<h1>After</h1>')
 const editor=change('<h1>Later</h1>')
 fireEvent.keyDown(editor.contentDOM,{key:'s',code:'KeyS',ctrlKey:true})
 await waitFor(()=>expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/files/page/text','PUT',{text:'<h1>Later</h1>',version:2}))
})
it('keeps edits typed while a save is in flight',async()=>{
 let finish!:(value:unknown)=>void
 mocked.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 show();change('Saved snapshot');fireEvent.click(screen.getByRole('button',{name:'Save'}))
 change('New unsaved typing')
 await act(async()=>finish({...item,version:2}))
 expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
 expect(screen.getByRole('textbox',{name:'File contents'})).toHaveTextContent('New unsaved typing')
})
it('shows a stale-version message without losing the draft',async()=>{
 const message='Someone saved a newer version. Copy your changes, reload, and try again.'
 mocked.mockRejectedValue(new Error(message))
 show();change('My draft');fireEvent.click(screen.getByRole('button',{name:'Save'}))
 expect(await screen.findByRole('alert')).toHaveTextContent(message)
 expect(screen.getByRole('textbox',{name:'File contents'})).toHaveTextContent('My draft')
 expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
})
it('warns on close, Escape and leaving the page only when changes are unsaved',()=>{
 const {onClose}=show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 change('My draft')
 fireEvent.click(screen.getByRole('button',{name:'Back'}))
 expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes?')
 expect(onClose).not.toHaveBeenCalled()
 fireEvent.keyDown(document,{key:'Escape'})
 expect(confirm).toHaveBeenCalledTimes(2)
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true)
 confirm.mockReturnValue(true)
 fireEvent.click(screen.getByRole('button',{name:'Close'}))
 expect(onClose).toHaveBeenCalledOnce()
})
it('previews the unsaved HTML with an empty sandbox and a folder-scoped policy',async()=>{
 show();change('<h1>Unsaved page</h1><script>parent.alert(1)</script>')
 fireEvent.click(screen.getByRole('button',{name:'Preview'}))
 const frame=await screen.findByTitle('Preview of index.html')
 expect(frame).toHaveAttribute('sandbox','')
 expect(frame).not.toHaveAttribute('allow')
 expect(frame).toHaveAttribute('srcdoc',expect.stringContaining('<h1>Unsaved page</h1>'))
 expect(frame).toHaveAttribute('srcdoc',expect.stringContaining('<base href="http://localhost:3000/api/community/preview/fixture/">'))
 expect(frame).toHaveAttribute('srcdoc',expect.stringContaining("default-src 'none'"))
 expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/previews','POST',{folder:'Website/site.test'})
 expect(mocked).not.toHaveBeenCalledWith(expect.stringContaining('/text'),'PUT',expect.anything())
})
it('reloads the latest saved version after confirming a dirty draft',async()=>{
 mocked.mockImplementation(async path=>path.endsWith('/versions')?[{version:3,size:100}]:{})
 vi.spyOn(window,'confirm').mockReturnValue(true)
 const {onSaved}=show();change('My draft')
 fireEvent.click(screen.getByRole('button',{name:'Reload saved file'}))
 await screen.findByText('Opened the saved version.')
 expect(fetch).toHaveBeenCalledWith('/api/community/grove/community/spaces/crew/files/page/content?inline=1&version=3')
 expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({version:3}),'<h1>Before</h1>')
 expect(screen.queryByText(/Unsaved changes/)).toBeNull()
})
it.each([['index.html',100,true],['notes.txt',2*1024*1024,true],['large.txt',2*1024*1024+1,false],['poster.png',100,false],['book.pdf',100,false]])('offers editing only for small text files: %s',async(name,size,editable)=>{
 mocked.mockImplementation(async path=>path.endsWith('/versions')?[]:{items:[{...item,name,size,folder:''}],used:size,limit:10000000,file_limit:10000000})
 render(<FileBank space={{id:'crew',name:'Crew',role:'member'}} user={{id:'sam',name:'Sam',email:'sam@example.test',role:'member',admin:0,can_start_spaces:true}}/>)
 fireEvent.click(await screen.findByRole('button',{name}))
 await screen.findByRole('dialog',{name})
 if(editable){
  fireEvent.click(await screen.findByRole('button',{name:'Edit'}))
  expect(await screen.findByRole('dialog',{name:'Edit '+name})).toBeInTheDocument()
  expect(await screen.findByRole('textbox',{name:'File contents'})).toBeInTheDocument()
 }else expect(screen.queryByRole('button',{name:'Edit'})).toBeNull()
})

it('previews a page in a subfolder against its site’s top folder',async()=>{
 render(<CodeEditor spaceId="crew" item={{...item,folder:'Website/site.test/docs'}} text={'<link rel="stylesheet" href="/styles.css"><a href="intro.html">Intro</a>'} onClose={vi.fn()} onSaved={vi.fn()}/>)
 fireEvent.click(screen.getByRole('button',{name:'Preview'}))
 const frame=await screen.findByTitle('Preview of index.html')
 expect(frame).toHaveAttribute('srcdoc',expect.stringContaining('<base href="http://localhost:3000/api/community/preview/fixture/docs/">'))
 expect(frame).toHaveAttribute('srcdoc',expect.stringContaining('href="http://localhost:3000/api/community/preview/fixture/styles.css"'))
 expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/previews','POST',{folder:'Website/site.test'})
})
