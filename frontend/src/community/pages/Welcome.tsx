import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MessageCircle, CalendarDays, CheckSquare } from 'lucide-react'
import { Logo } from '../components/Logo'
import { api, type User } from '../lib/community'
import { JoinByLink } from '../components/JoinByLink'
import { GroveContext } from '../lib/grove'

export function Welcome({ onLogin }: { onLogin: (user: User, usedInvite: boolean) => void }) {
  const invite = new URLSearchParams(location.search).get('invite') || ''
  // The server installer prints a link carrying the setup code for the host account.
  const setupCode = new URLSearchParams(location.search).get('setup') || ''
  const navigate = useNavigate()
  const grove = useContext(GroveContext)
  const [setup, setSetup] = useState<boolean | null>(null)
  const [server, setServer] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  // A new Grove first asks: join one you were invited to, or create this one. The installer's link goes straight to create.
  const [creating, setCreating] = useState(Boolean(setupCode))
  const [pasting, setPasting] = useState(false)
  const [joining, setJoining] = useState(Boolean(invite))
  const [mode, setMode] = useState<'login' | 'signup'>(invite ? 'signup' : 'login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)
  useEffect(() => { api<{ setup: boolean; setup_code?: boolean; public_url?: string | null }>('/auth/status').then(v => { setSetup(v.setup); setNeedsCode(Boolean(v.setup_code)); setServer(v.public_url ? new URL(v.public_url).host : '') }).catch(e => setError(e.message)) }, [])
  const signup = setup || joining || mode === 'signup'
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await api<User>(signup ? '/auth/signup' : '/auth/login', 'POST', signup ? { ...body, invite } : body)
      // Signup consumes the invite. After a plain sign-in the URL keeps it so the app can join that space.
      if (!invite) navigate('/community', { replace: true })
      onLogin(result, Boolean(signup && invite))
    }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="welcome">
    <section className="welcome-story"><div className="brand"><span>arynwood <b>Grove</b></span></div>
      <div><Logo className="welcome-logo" label="Arynwood" /><span className="eyebrow">A place for your people</span><h1>Life, together.</h1><p>Stay in touch. Make plans. Keep things in order.</p>
        <div className="welcome-features"><span><MessageCircle /> Conversations</span><span><CalendarDays /> Shared plans</span><span><CheckSquare /> Everyday life</span></div></div>
      <small>Your space. Your data.</small>
    </section>
    <section className="welcome-form"><span className="badge">Grove{grove.version ? ` ${grove.version}` : ''}</span><h2>{setup && !invite && !creating ? 'Welcome to a new Grove' : setup ? 'Create your Grove' : joining ? 'Join this Grove' : 'Welcome back'}</h2>
      <p className="muted-text">{server ? `This Grove keeps accounts and spaces on its server, ${server}.` : grove.local ? 'This Grove keeps accounts and spaces on this computer.' : `This Grove keeps accounts and spaces at ${new URL(grove.url).host}.`}</p>
      {setup && !invite && !creating ? <div className="setup-choices">
        <section><h3>Join a Grove</h3><p className="muted-text">Someone invited you? Paste the invitation link they sent.</p><JoinByLink /></section>
        <section><h3>Create your Grove</h3><p className="muted-text">Make the host account for this server. Afterwards you can move it to your own domain in Settings.</p><button className="primary" onClick={() => setCreating(true)}>Create your Grove <ArrowRight size={16} /></button></section>
      </div> : recovering ? <PasswordRecovery onBack={()=>setRecovering(false)}/> : <form onSubmit={submit}>
        {signup && <label>Your name<input name="name" autoComplete="name" required maxLength={80} /></label>}
        {setup && <label>Space name<input name="space" defaultValue="Our home" required maxLength={80} /></label>}
        {setup && needsCode && <><label>Setup code<input name="setup_code" defaultValue={setupCode} required maxLength={128} autoComplete="off" spellCheck={false} /></label>
          <small>The installer printed this code, so only the person who set up this server becomes its host. On the server, <code>sudo arynwood-grove setup-link</code> shows it again.</small></>}
        <label>Email<input type="email" name="email" autoComplete="username" required maxLength={254} /></label>
        <label>Password<input type="password" name="password" minLength={12} maxLength={256} autoComplete={signup ? 'new-password' : 'current-password'} required /></label>
        {signup && <small>Use at least 12 characters.</small>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait' : signup ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
        {invite && !setup && !joining && <p className="muted-text">Sign in to join the space you were invited to.</p>}
        {!setup && <button type="button" className="text-button" onClick={() => { setMode(signup ? 'login' : 'signup'); setJoining(!signup && Boolean(invite)) }}>{signup ? 'I already have an account' : 'Create an account'}</button>}
        {!signup&&<button type="button" className="text-button" onClick={()=>setRecovering(true)}>Forgot password?</button>}
        {setup && !invite && <button type="button" className="text-button" onClick={() => setCreating(false)}>Back</button>}
        {!setup && !invite && <button type="button" className="text-button" onClick={() => setPasting(p => !p)}>Join with an invitation link</button>}
      </form>}
      {pasting && !setup && <JoinByLink />}
    </section>
  </div>
}


function PasswordRecovery({onBack}:{onBack:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false)
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError('')
    const body=Object.fromEntries(new FormData(event.currentTarget))
    if(body.password!==body.confirm){setError('The new passwords do not match.');return}
    setBusy(true)
    try{await api('/auth/password/reset','POST',{token:String(body.token).trim(),password:body.password});setDone(true)}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <section aria-label="Password recovery"><h3>Reset your password</h3>
    {done?<><p role="status">Password reset. All previous sessions are signed out. Sign in with your new password.</p><button className="primary" onClick={onBack}>Back to sign in</button></>:<>
      <p className="muted-text">Ask the host for a one-use reset code. It expires in 15 minutes. No reset email is sent by this instance.</p>
      <details><summary>I manage this host</summary><p>Run this from the Community backend directory on the host machine, replacing the email with your account:</p><code>python -m backend.community.recovery your-email@example.com</code><p>Use the backend’s Python environment. Keep the code private.</p></details>
      <form onSubmit={submit}>
        <label>Reset code<input name="token" required maxLength={128} autoComplete="off" spellCheck={false}/></label>
        <label>New password<input type="password" name="password" required minLength={12} maxLength={256} autoComplete="new-password"/></label>
        <label>Confirm new password<input type="password" name="confirm" required minLength={12} maxLength={256} autoComplete="new-password"/></label>
        {error&&<p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy?'Resetting…':'Reset password'}</button>
        <button type="button" className="text-button" disabled={busy} onClick={onBack}>Back to sign in</button>
      </form>
    </>}
  </section>
}
