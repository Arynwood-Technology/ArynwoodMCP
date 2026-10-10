export const MAX_ATTACHMENT_BYTES=1024*1024
const MAX_WIRE_LENGTH=Math.ceil(MAX_ATTACHMENT_BYTES/3)*4+1024
export interface Attachment {name:string;bytes:Uint8Array}
// eslint-disable-next-line no-control-regex -- control characters are exactly what this removes
export function safeFilename(value:string){return value.replace(/[\\/:\u0000-\u001f\u007f]/g,'_').slice(0,160)||'attachment.bin'}
export function decodeAttachment(content:string):Attachment|null {
  if(content.length>MAX_WIRE_LENGTH)return null
  try {
    const data=JSON.parse(content)
    if(typeof data.name!=='string'||typeof data.base64!=='string'||!data.base64||! /^[A-Za-z0-9+/]*={0,2}$/.test(data.base64))return null
    const raw=atob(data.base64)
    if(raw.length>MAX_ATTACHMENT_BYTES)return null
    return {name:safeFilename(data.name),bytes:Uint8Array.from(raw,c=>c.charCodeAt(0))}
  }catch{return null}
}
export async function encodeAttachment(file:File):Promise<string>{
  if(file.size>MAX_ATTACHMENT_BYTES)throw Error('Files must be 1 MB or smaller.')
  if(!file.size)throw Error('This file is empty.')
  const bytes=new Uint8Array(await file.arrayBuffer());let raw=''
  for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192))
  return JSON.stringify({name:safeFilename(file.name),base64:btoa(raw)})
}
