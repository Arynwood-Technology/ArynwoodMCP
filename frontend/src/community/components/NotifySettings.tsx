import { Bell, BellOff } from 'lucide-react'
import { canNotify, chooseNotify, notifyBlocked, useNotifyPrefs, type ChatAlerts } from '../lib/notify'

const BLOCKED = 'This browser is blocking notifications from this Grove. Allow them in the browser’s settings for this site.'

/** A bell beside Messages: notify me of new messages on this device, or not. */
export function NotifyMessages() {
  const { messages } = useNotifyPrefs()
  if (!canNotify()) return null
  return <button className="secondary" aria-pressed={messages} title={notifyBlocked() ? BLOCKED : 'Notify me of new messages on this device'} onClick={() => void chooseNotify({ messages: !messages })}>
    {messages ? <Bell size={16} /> : <BellOff size={16} />} {messages ? 'Notifying' : 'Notify me'}
  </button>
}

/** Public chat's notifications on this device. */
export function NotifyChat({ className, style, selectStyle }: { className?: string; style?: React.CSSProperties; selectStyle?: React.CSSProperties }) {
  const { chat } = useNotifyPrefs()
  if (!canNotify()) return null
  return <label className={className} style={style}>Public chat notifications
    <select value={chat} onChange={e => void chooseNotify({ chat: e.target.value as ChatAlerts })} style={selectStyle ?? { width: '100%' }}>
      <option value="off">Off</option><option value="mentions">When I’m mentioned</option><option value="all">Every message</option>
    </select>
  </label>
}

/** People & identity: both choices together, and what the browser allows. */
export function NotifyPanel() {
  const { messages } = useNotifyPrefs()
  return <section className="panel">
    <h2><Bell size={18} /> Notifications</h2>
    {canNotify() ? <>
      <label className="check-row"><input type="checkbox" checked={messages} onChange={e => void chooseNotify({ messages: e.target.checked })} /> New messages</label>
      <NotifyChat className="notify-field" />
      {notifyBlocked() && <p className="error" role="alert">{BLOCKED}</p>}
      <p className="muted-text">Mentioned means someone says your nickname, or writes to you alone. These are for this device, while the Grove is open in a tab, and show who wrote and the start of what they said.</p>
    </> : <p className="muted-text">This browser can’t show notifications.</p>}
  </section>
}
