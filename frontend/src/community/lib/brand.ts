import { useEffect, useState, type CSSProperties } from 'react'
import { api } from './community'
import { groveAddress, groveTheme } from './grove'
export type Brand = { branded:boolean; name:string; tagline:string; accent:string; theme?:Record<string,string>; site_url:string; site_label:string; shop_url:string; shop_label:string; logo_url:string; picture_url?:string }
export const defaultBrand:Brand={branded:false,name:'Arynwood Grove',tagline:'The Grove, your community – your choices',accent:'#4fd1ab',site_url:'',site_label:'Website',shop_url:'',shop_label:'Shop',logo_url:''}
/** Look & feel announces a saved look, so the page around it changes at once. */
export const LOOK_CHANGED='grove-look-changed'
export function useBrand(enabled=true){
  const [brand,setBrand]=useState(defaultBrand)
  useEffect(()=>{
    if(!enabled)return
    let active=true
    // The pictures it names are reached through Arynwood, as everything else on the Grove is.
    const load=()=>{api<Brand>('/brand').then(value=>{if(active&&typeof value?.branded==='boolean')setBrand({...value,logo_url:groveAddress(value.logo_url),picture_url:value.picture_url&&groveAddress(value.picture_url),theme:value.theme&&groveTheme(value.theme)})}).catch(()=>{})}
    load();window.addEventListener(LOOK_CHANGED,load)
    return()=>{active=false;window.removeEventListener(LOOK_CHANGED,load)}
  },[enabled])
  // Inside Arynwood the window is the app's: a Grove's look colours the Community page only, and leaves the
  // window's background, title and icon alone.
  return brand
}
export function brandStyle(brand:Brand):CSSProperties|undefined {
  if(brand.theme&&Object.keys(brand.theme).length)return themeStyle(brand.theme)
  return brand.accent===defaultBrand.accent?undefined:{'--accent':brand.accent,'--accent-hover':brand.accent,'--accent-text':brand.accent,'--accent2':brand.accent,'--accent-soft':`color-mix(in srgb, ${brand.accent} 14%, transparent)`,'--on-accent':'#0f1314'} as CSSProperties
}
/** A look's tokens as a style: custom properties, and whether the browser's own controls are light or dark. */
export function themeStyle(theme:Record<string,string>):CSSProperties {
  const {['--scheme']:scheme,...tokens}=theme
  return {...tokens,...(scheme?{colorScheme:scheme}:{})} as CSSProperties
}
