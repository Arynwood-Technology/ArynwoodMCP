import {expect,it} from 'vitest'
import {decodeAttachment,MAX_ATTACHMENT_BYTES} from './attachments'
it('treats a received HTML file as downloadable bytes, with a safe filename',()=>{
 const file=decodeAttachment(JSON.stringify({name:'../../page.html',base64:btoa('<script>alert(1)</script>')}))
 expect(file?.name).toBe('.._.._page.html');expect(new TextDecoder().decode(file?.bytes)).toContain('<script>')
})
it('rejects oversized or malformed peer attachments',()=>{
 for(const content of ['<script>','{}',JSON.stringify({name:'file',base64:'data:text/html;test'}),'a'.repeat(MAX_ATTACHMENT_BYTES*2)])expect(decodeAttachment(content)).toBeNull()
})
