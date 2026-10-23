import { expect, it } from 'vitest'
import { describeActivity, type Activity } from './activity'

const row = (action: string, extra: Partial<Activity> = {}): Activity => ({ id: 1, at: '2026-10-14T10:00:00Z', action, actor_id: 'sam', actor_name: 'Sam',
  space_id: 'crew', space_name: 'Crew', target_id: null, target_name: '', details: {}, ...extra })

it('says who did what, where', () => {
  expect(describeActivity(row('entry_created', { target_name: 'Print badges', details: { kind: 'task' } }))).toBe('Sam added the task “Print badges” in Crew')
  expect(describeActivity(row('entry_created', { target_name: 'Milk', details: { kind: 'item', parent: 'Groceries' } }))).toBe('Sam added “Milk” to the list “Groceries” in Crew')
  expect(describeActivity(row('entry_updated', { target_name: 'Print badges', details: { kind: 'task', done: true, author: 'Ada' } }))).toBe('Sam marked Ada’s task “Print badges” done in Crew')
  expect(describeActivity(row('entry_deleted', { target_name: 'Schedule', details: { kind: 'board', children: 1 } }))).toBe('Sam deleted the board post “Schedule”, with 1 reply in Crew')
  expect(describeActivity(row('space_deleted', { details: { members: 1, items: 12 } }))).toBe('Sam deleted the space Crew, with 1 member and 12 items')
  expect(describeActivity(row('space_updated', { details: { renamed_from: 'Team', topic: '' } }))).toBe('Sam renamed Team to Crew and cleared its topic')
  expect(describeActivity(row('space_updated', { details: { topic: 'Opening night' } }))).toBe('Sam set the topic of Crew to “Opening night”')
})

it('never names a private item, and names people done to', () => {
  expect(describeActivity(row('entry_created', { target_name: '', details: { kind: 'note', private: true } }))).toBe('Sam added a private note in Crew')
  expect(describeActivity(row('sign_in_failed', { actor_name: '', target_name: 'Ada', space_name: '' }))).toBe('Someone tried to sign in as Ada with the wrong password')
  expect(describeActivity(row('grove_role_changed', { target_name: 'Ada', space_name: '', details: { role: 'manager' } }))).toBe('Sam made Ada a manager of the Grove')
  expect(describeActivity(row('signed_up', { details: { via: 'public link', invited_by: 'Ada' } }))).toBe('Sam joined the Grove through the public link from Ada to Crew')
  expect(describeActivity(row('site_imported', { target_name: 'Website/festival.test', details: { url: 'https://festival.test/', status: 'done', added: 9, changed: 1 } })))
    .toBe('Sam imported the website https://festival.test/ into “Website/festival.test” in Crew: 9 new, 1 changed')
  expect(describeActivity(row('something_new'))).toBe('Sam: something new')
})

it('describes an in-Grove file edit and its version', () => {
  expect(describeActivity(row('file_edited', { target_name: 'Website/index.html', details: { version: 2 } })))
    .toBe('Sam edited “Website/index.html” in Crew (version 2)')
})

it('describes the website being brought in, published, put back and taken down', () => {
  expect(describeActivity(row('site_unpacked', { target_name: 'Website/roguefest-site', details: { zip: 'roguefest-site.zip', added: 75, changed: 0 } })))
    .toBe('Sam unpacked “roguefest-site.zip” into “Website/roguefest-site” in Crew: 75 new, 0 changed')
  expect(describeActivity(row('site_published', { target_name: 'Website/roguefest-site', details: { files: 75 } }))).toBe('Sam published the website from “Website/roguefest-site” in Crew (75 files)')
  expect(describeActivity(row('site_taken_down', { space_name: '' }))).toBe('Sam took the website down')
  expect(describeActivity(row('webmaster_changed', { target_name: 'Ada', space_name: '', details: { webmaster: true } }))).toBe('Sam made Ada a webmaster')
  expect(describeActivity(row('webmaster_changed', { target_name: 'Ada', space_name: '', details: { webmaster: false } }))).toBe('Sam stopped Ada being a webmaster')
})

it('describes notes left on a website preview', () => {
  const note = (action: string) => describeActivity(row(action, { target_name: 'Website/roguefest-site', details: { page: '/about', note: 'The date moved' } }))
  expect(note('site_note_added')).toBe('Sam left a note on /about of “Website/roguefest-site”: “The date moved”')
  expect(note('site_note_done')).toBe('Sam marked a note on /about of “Website/roguefest-site” done: “The date moved”')
  expect(note('site_note_reopened')).toBe('Sam opened a note on /about of “Website/roguefest-site” again: “The date moved”')
})

it('describes changes to the Grove’s look', () => {
  expect(describeActivity(row('look_changed', { space_name: '' }))).toBe('Sam changed how the Grove looks')
  expect(describeActivity(row('look_picture_changed', { space_name: '', details: { picture: 'picture', removed: true } }))).toBe('Sam removed the Grove’s login page picture')
})
