import { afterEach, expect, it, vi } from 'vitest'
import { groveAddress, groveTheme, groveUrl, openOutside, previewUrl, saveLink } from './grove'

const download = vi.hoisted(() => ({ downloadFile: vi.fn(async () => {}) }))
vi.mock('../../lib/download', () => download)
afterEach(() => { vi.restoreAllMocks(); download.downloadFile.mockClear() })

it('reaches the Grove, and the addresses it hands out, through Arynwood', () => {
  expect(groveUrl('/messages/photos/p1')).toBe('/api/community/grove/messages/photos/p1')
  expect(groveAddress('/api/brand/logo?v=3')).toBe('/api/community/grove/brand/logo?v=3')
  expect(groveAddress('')).toBe('')
  expect(groveAddress('https://festival.example/logo.png')).toBe('https://festival.example/logo.png')
  expect(groveTheme({ '--login-image': 'url("/api/brand/picture?v=2")', '--bg': '#000' }))
    .toEqual({ '--login-image': 'url("/api/community/grove/brand/picture?v=2")', '--bg': '#000' })
})

it('keeps a preview at the address the Grove gave it, which Arynwood answers without the sign-in', () => {
  expect(previewUrl('/api/community/preview/abc.0123/')).toBe('/api/community/preview/abc.0123/')
})

it('opens outside links in the browser, and saves downloads as files', async () => {
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  const link = document.createElement('a')
  link.href = 'https://festival.example/'
  const event = { preventDefault: vi.fn(), currentTarget: link } as unknown as React.MouseEvent<HTMLAnchorElement>
  openOutside(event)
  expect(event.preventDefault).toHaveBeenCalled()
  expect(opened).toHaveBeenCalledWith('https://festival.example/', '_blank', 'noopener,noreferrer')

  link.href = 'http://localhost:3000/api/community/grove/messages/files/f1'
  saveLink('Run of show.pdf')(event)
  expect(download.downloadFile).toHaveBeenCalledWith('http://localhost:3000/api/community/grove/messages/files/f1', 'Run of show.pdf')
})
