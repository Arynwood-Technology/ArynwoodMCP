import { expect, it } from 'vitest'
import { brandStyle, defaultBrand } from './brand'
it('leaves the default palette and legacy accent-only overrides intact',()=>{
 expect(brandStyle(defaultBrand)).toBeUndefined()
 expect(brandStyle({...defaultBrand,theme:{}})).toBeUndefined()
 expect(brandStyle({...defaultBrand,accent:'#aaffcc'})).toEqual({'--accent':'#aaffcc','--accent-hover':'#aaffcc','--accent-text':'#aaffcc','--accent2':'#aaffcc','--accent-soft':'color-mix(in srgb, #aaffcc 14%, transparent)','--on-accent':'#0f1314'})
})
it('applies server theme tokens without replacing the accessible variants',()=>{
 const theme={'--bg':'#091c32','--text':'#f4eee8','--accent':'#e02767','--accent-text':'#e96794','--on-accent':'#ffffff'}
 expect(brandStyle({...defaultBrand,accent:'#e02767',theme})).toEqual(theme)
})
