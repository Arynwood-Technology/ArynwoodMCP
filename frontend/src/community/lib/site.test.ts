import { expect, it } from 'vitest'
import { asHtml, findQuote, pageAddress, pageFile, pinsFor, samePage, siteSearch, siteTarget, type SiteNote } from './site'

it('gives each page the address the preview and the live site use', () => {
  expect(['index.html', 'about.html', 'docs/index.html', 'docs/guide.htm', '404.html'].map(pageAddress)).toEqual(['/', '/about', '/docs/', '/docs/guide', '/404'])
  const paths = ['index.html', 'about.html', 'docs/index.html', 'img/logo.png']
  expect(['/', '/about', '/about.html', '/docs', '/docs/', '/docs/index.html', '/img/logo.png', '/nowhere', '/about?x=1#top'].map(a => pageFile(a, paths)))
    .toEqual(['index.html', 'about.html', 'about.html', 'docs/index.html', 'docs/index.html', 'docs/index.html', 'img/logo.png', null, 'about.html'])
  expect(samePage('/about', '/about.html')).toBe(true)
  expect(samePage('/docs/', '/docs/index.html')).toBe(true)
  expect(samePage('/', '/index.html')).toBe(true)
  expect(samePage('/about', '/docs')).toBe(false)
})

it('finds words from the page in its code, across line breaks, tags and entities', () => {
  const source = '<h1>Rogue&shy;Fest</h1>\n<p class="lead">Submissions close\n   <strong>October 1</strong>, don&rsquo;t wait</p>\n<p>Submissions close soon</p>'
  const found = findQuote(source, 'Submissions close October 1, don’t wait')!
  expect(source.slice(found.from, found.to)).toBe('Submissions close\n   <strong>October 1</strong>, don&rsquo;t wait')
  expect([found.count, found.plain]).toEqual([1, false])
  const twice = findQuote(source, 'Submissions close')!
  expect([twice.count, twice.plain, source.slice(twice.from, twice.to)]).toEqual([2, true, 'Submissions close'])
  expect(findQuote(source, 'SUBMISSIONS CLOSE SOON')).toMatchObject({ count: 1, plain: true })
  expect(findQuote(source, 'Not on the page')).toBeNull()
  expect(findQuote(source, '   ')).toBeNull()
  expect(asHtml('Fish & <chips>')).toBe('Fish &amp; &lt;chips&gt;')
})

it('pins open notes on the page shown, numbered among all of them', () => {
  const note = (id: string, extra: Partial<SiteNote>): SiteNote => ({ id, space_id: 's', folder: 'Website/site', page: '/', selector: 'h1:nth-of-type(1)', quote: 'Hi', x: 0.5, y: 0.5,
    device: '', body: 'Change it', suggestion: null, status: 'open', author_id: 'u', author: 'Ann', created: '', closed_by: '', closed: null, replies: [], ...extra })
  const notes = [note('a', {}), note('b', { page: '/about' }), note('c', { status: 'done' }), note('d', { selector: '' }), note('e', { page: '/index.html' })]
  expect(pinsFor(notes, '/', '').map(p => [p.id, p.n])).toEqual([['a', 1], ['e', 5]])
  expect(pinsFor(notes, '/', 'c').map(p => [p.id, p.done])).toEqual([['a', false], ['c', true], ['e', false]])
})

it('keeps the site being edited or previewed in the page address', () => {
  const target = { space: 'web', folder: 'Website/roguefest-site', mode: 'edit' as const }
  expect(siteTarget(siteSearch(target))).toEqual(target)
  expect(siteTarget('?site=web&folder=Website%2Fx')).toEqual({ space: 'web', folder: 'Website/x', mode: 'review' })
  expect(siteTarget('')).toBeNull()
  expect(siteSearch(null)).toBe('')
})
