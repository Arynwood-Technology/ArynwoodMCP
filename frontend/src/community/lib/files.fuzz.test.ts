import { expect, it } from 'vitest'
import fc from 'fast-check'
import { rebased } from './files'

const previewBase = '/P/Website/demo'

it('fuzzes preview rewriting with arbitrary document text', () => {
  fc.assert(fc.property(fc.string({ maxLength: 4096 }), source => {
    const result = rebased(source, previewBase)
    expect(typeof result).toBe('string')
  }), { numRuns: 2000 })
})

it('fuzzes local rooted paths without escaping the preview base', () => {
  const path = fc.string({ maxLength: 256 })
    .map(value => encodeURIComponent(value))
    .filter(value => value !== '' && value !== 'community' && value !== 'api')

  fc.assert(fc.property(path, value => {
    const source = `<img src="/${value}">`
    expect(rebased(source, previewBase)).toBe(`<img src="${previewBase}/${value}">`)
  }), { numRuns: 2000 })
})

it('fuzzes absolute web addresses without rewriting them', () => {
  fc.assert(fc.property(fc.webUrl(), url => {
    const source = `<a href="${url}">external</a>`
    expect(rebased(source, previewBase)).toBe(source)
  }), { numRuns: 2000 })
})
