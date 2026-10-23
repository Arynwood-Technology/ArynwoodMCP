import type { Kind } from './community'

/** One row of the Grove's activity log (GET /admin/activity). Names are as they were then. */
export interface Activity {
  id: number; at: string; action: string
  actor_id: string | null; actor_name: string; space_id: string | null; space_name: string
  target_id: string | null; target_name: string; details: Record<string, string | number | boolean>
}

const things: Record<Kind, string> = { board: 'board post', note: 'note', task: 'task', event: 'event', chat: 'message', list: 'list', item: 'list item', comment: 'reply' }
const groveRoles: Record<string, string> = { owner: 'an owner', manager: 'a manager', member: 'a member' }
const quoted = (text: unknown) => `“${text}”`
const count = (n: unknown, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** A log row in words, e.g. Sam added the task “Print badges” in Volunteers. */
export function describeActivity(a: Activity): string {
  const who = a.actor_name || 'Someone', d = a.details, space = a.space_name, here = space ? ` in ${space}` : ''
  const thing = things[d.kind as Kind] ?? 'item', whose = d.author ? `${d.author}’s ${thing}` : `the ${thing}`
  const through = `through ${d.via === 'public link' ? 'the public link' : 'an invitation'}${d.invited_by ? ` from ${d.invited_by}` : ''}`
  switch (a.action) {
    case 'signed_up': return d.via === 'setup' ? `${who} created this Grove, with the space ${space}` : `${who} joined the Grove ${through} to ${space}`
    case 'joined_space': return `${who} joined ${space} ${through}`
    case 'signed_in': return `${who} signed in`
    case 'sign_in_failed': return `Someone tried to sign in as ${a.target_name} with the wrong password`
    case 'password_changed': return `${who} changed their password`
    case 'password_reset': return `${who} reset their password with a recovery code`
    case 'recovery_code_issued': return `The server issued a password recovery code for ${a.target_name}`
    case 'workspace_staged': return `${who} staged the ${d.kit} workspace for ${d.client}${here}: ${d.entries} items, ${d.files} files and ${d.folders} folders`
    case 'space_created': return `${who} started the space ${space}`
    case 'space_updated': {
      const renamed = d.renamed_from !== undefined ? `renamed ${d.renamed_from} to ${space}` : ''
      const which = renamed ? 'its topic' : `the topic of ${space}`
      const topic = d.topic === undefined ? '' : d.topic ? `set ${which} to ${quoted(d.topic)}` : `cleared ${which}`
      return `${who} ${[renamed, topic].filter(Boolean).join(' and ')}`
    }
    case 'space_deleted': return `${who} deleted the space ${space}, with ${count(d.members, 'member')} and ${count(d.items, 'item')}`
    case 'space_exported': return `${who} downloaded a copy of ${space}`
    case 'space_role_changed': return `${who} made ${a.target_name} ${d.role === 'owner' ? 'an owner' : 'a member'} of ${space}`
    case 'member_removed': return `${who} removed ${a.target_name} from ${space}`
    case 'member_left': return `${who} left ${space}`
    case 'invite_created': return `${who} made an invitation to ${space}`
    case 'public_link_created': return `${who} ${d.replaced ? 'replaced' : 'made'} the public link to ${space}`
    case 'public_link_turned_off': return `${who} turned off the public link to ${space}`
    case 'entry_created':
      if (d.private) return `${who} added a private ${thing}${here}`
      if (d.kind === 'chat') return `${who} wrote${here}: ${quoted(a.target_name)}`
      if (d.kind === 'comment') return `${who} replied to ${quoted(d.parent)}${here}: ${quoted(a.target_name)}`
      if (d.kind === 'item') return `${who} added ${quoted(a.target_name)} to the list ${quoted(d.parent)}${here}`
      return `${who} added the ${thing} ${quoted(a.target_name)}${here}`
    case 'entry_updated':
      if (d.private) return `${who} changed a private ${thing}${here}`
      if (d.done !== undefined) return `${who} marked ${whose} ${quoted(a.target_name)} ${d.done ? 'done' : 'not done'}${here}`
      return `${who} edited ${whose} ${quoted(a.target_name)}${here}`
    case 'entry_deleted': {
      if (d.private) return `${who} deleted a private ${thing}${here}`
      const children = d.children ? `, with ${d.kind === 'list' ? count(d.children, 'item') : count(d.children, 'reply', 'replies')}` : ''
      return `${who} deleted ${whose} ${quoted(a.target_name)}${children}${here}`
    }
    case 'grove_role_changed': return `${who} made ${a.target_name} ${groveRoles[String(d.role)] ?? 'a member'} of the Grove`
    case 'file_uploaded': return `${who} uploaded ${quoted(a.target_name)}${here}`
    case 'file_edited': return `${who} edited ${quoted(a.target_name)}${here} (version ${d.version})`
    case 'file_version_added': return `${who} uploaded version ${d.version} of ${quoted(a.target_name)}${here}`
    case 'file_downloaded': return `${who} downloaded ${quoted(a.target_name)}${d.version ? ` (version ${d.version})` : ''}${here}`
    case 'folder_created': return `${who} made the folder ${quoted(a.target_name)}${here}`
    case 'file_renamed': return `${who} renamed ${quoted(d.from)} to ${quoted(a.target_name)}${here}`
    case 'file_moved': return `${who} moved ${quoted(d.from)} to ${quoted(a.target_name)}${here}`
    case 'file_deleted': return `${who} moved ${quoted(a.target_name)} to the trash${here}`
    case 'file_restored': return `${who} brought ${quoted(a.target_name)} back from the trash${here}`
    case 'file_purged': return `${who} deleted ${quoted(a.target_name)} for good${here}`
    case 'folder_downloaded': return `${who} downloaded the folder ${quoted(a.target_name)} as a .zip${here}`
    case 'site_imported': return d.status === 'failed' ? `${who} tried to import the website ${d.url} into ${space}` : `${who} imported the website ${d.url} into ${quoted(a.target_name)}${here}: ${d.added} new, ${d.changed} changed`
    case 'site_unpacked': return `${who} unpacked ${quoted(d.zip)} into ${quoted(a.target_name)}${here}: ${d.added} new, ${d.changed} changed`
    case 'site_started': return `${who} started a one-page website in ${quoted(a.target_name)}${here}`
    case 'site_published': return `${who} published the website from ${quoted(a.target_name)}${here} (${count(d.files, 'file')})`
    case 'site_put_back': return `${who} put back the website published from ${quoted(a.target_name)} on ${new Date(String(d.published)).toLocaleDateString()}`
    case 'site_taken_down': return `${who} took the website down`
    case 'site_note_added': return `${who} left a note on ${d.page} of ${quoted(a.target_name)}: ${quoted(d.note)}`
    case 'site_note_done': return `${who} marked a note on ${d.page} of ${quoted(a.target_name)} done: ${quoted(d.note)}`
    case 'site_note_reopened': return `${who} opened a note on ${d.page} of ${quoted(a.target_name)} again: ${quoted(d.note)}`
    case 'site_note_deleted': return `${who} deleted a note on ${d.page} of ${quoted(a.target_name)}: ${quoted(d.note)}`
    case 'webmaster_changed': return d.webmaster ? `${who} made ${a.target_name} a webmaster` : `${who} stopped ${a.target_name} being a webmaster`
    case 'look_changed': return `${who} changed how the Grove looks`
    case 'look_reset': return `${who} put the Grove’s look back as its host set it up`
    case 'look_picture_changed': return `${who} ${d.removed ? 'removed' : 'changed'} the Grove’s ${d.picture === 'logo' ? 'logo' : 'login page picture'}`
    case 'wish_made': return `${who} made a wish${here}`
    case 'grove_setting_changed': return d.chat_privacy ? (d.chat_privacy === 'open' ? `${who} opened Public chat’s room to the IRC network` : `${who} made Public chat’s room private to this Grove`)
      : d.space_creation === 'managers' ? `${who} let only owners and managers start spaces` : `${who} let everyone start spaces`
    default: return `${who}: ${a.action.replaceAll('_', ' ')}`
  }
}
