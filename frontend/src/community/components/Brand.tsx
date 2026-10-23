import { Logo } from './Logo'
import { type Brand } from '../lib/brand'
import { openOutside } from '../lib/grove'
export function BrandLogo({brand,welcome=false}:{brand:Brand;welcome?:boolean}){
  if(!brand.branded)return <Logo className={welcome?'welcome-logo':'logo'} label={welcome?'Arynwood':'Arynwood tree logo'}/>
  return brand.logo_url?<img className={welcome?'brand-logo welcome-logo':'brand-logo'} src={brand.logo_url} alt={brand.name}/>:null
}
export function BrandLinks({brand}:{brand:Brand}){
  return <div className="brand-links">{brand.site_url&&<a href={brand.site_url} onClick={openOutside}>{brand.site_label}</a>}{brand.shop_url&&<a href={brand.shop_url} onClick={openOutside}>{brand.shop_label}</a>}</div>
}
export function BrandCredit(){return <small className="brand-credit"><a href="https://arynwood.com/community/" onClick={openOutside}>Runs on Arynwood Grove</a></small>}
