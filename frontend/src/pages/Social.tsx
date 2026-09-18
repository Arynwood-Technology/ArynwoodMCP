import { useEffect, useRef, useState } from 'react'
import { Share2, Link2, Unlink, RefreshCw, Send, Upload, X, Check, AlertCircle, Clock } from 'lucide-react'
import { request } from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SocialAccount {
  id: number
  platform: Platform
  account_id: string
  account_name: string
  account_type: string
  token_expires_at: string | null
  created_at: string
}

interface PostResult {
  platform: string
  account: string
  status: 'published' | 'failed'
  post_id?: string
  error?: string
}

interface PostRecord {
  id: number
  platform: string
  account_id: string
  content: string
  media_url: string
  post_id: string
  status: 'published' | 'failed' | 'pending'
  error: string | null
  created_at: string
}

interface YoutubeVideo {
  video_id: string
  title: string
  published_at: string
  duration: string
  views: number
  likes: number
  comments: number
}

interface YoutubeInsights {
  video_count?: number
  avg_views?: number
  avg_likes?: number
  best_performer?: { title: string; views: number } | null
  worst_performer?: { title: string; views: number } | null
  above_average?: string[]
  low_sample_warning?: boolean
  note?: string
}

interface YoutubeChannelAnalytics {
  account_id: number
  account_name: string
  channel?: { id: string; title: string; subscribers: number; total_views: number; video_count: number }
  videos?: YoutubeVideo[]
  insights?: YoutubeInsights
  error?: string
}

interface YoutubeUpload {
  id: number
  filename: string
  status: 'published' | 'failed'
  video_id: string | null
  title: string | null
  error: string | null
  project_slug: string | null
  created_at: string
}

interface ContentProject {
  id: number
  slug: string
  name: string
  base_dir: string
  youtube_account_id: number | null
  youtube_account_name: string | null
  created_at: string
}

type Platform = 'facebook' | 'instagram' | 'youtube' | 'linkedin'

// ── Platform metadata ─────────────────────────────────────────────────────────

const PLATFORMS: Record<Platform, { label: string; color: string; icon: string; hint: string }> = {
  facebook:  { label: 'Facebook',  color: '#1877f2', icon: 'f', hint: 'Posts to connected Pages. Text and/or image URL.' },
  instagram: { label: 'Instagram', color: '#e1306c', icon: 'ig', hint: 'Requires a publicly accessible image URL. No text-only posts.' },
  youtube:   { label: 'YouTube',   color: '#ff0000', icon: 'yt', hint: 'Upload a video file. Title required.' },
  linkedin:  { label: 'LinkedIn',  color: '#0a66c2', icon: 'in', hint: 'Posts to your personal profile. Text and/or image URL.' },
}

const ALL_PLATFORMS = Object.keys(PLATFORMS) as Platform[]

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '16px 20px',
}

const inp: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 6, padding: '8px 10px',
  fontSize: 13, width: '100%', boxSizing: 'border-box',
}

const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6,
}

// ── Platform icon pill ────────────────────────────────────────────────────────

function PlatformIcon({ p, size = 32 }: { p: Platform; size?: number }) {
  const { color, icon } = PLATFORMS[p]
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 4,
      background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.35, flexShrink: 0,
    }}>
      {icon}
    </div>
  )
}

// ── OAuth credential setup ────────────────────────────────────────────────────

interface SocialConfig {
  env_file: string
  redirect_base: string
  configured: Record<Platform, boolean>
  env_vars: Record<Platform, string[]>
}

/** Platforms sharing the same credential variables (Facebook + Instagram share one
 *  Meta app) collapse into one line, and only ones still missing credentials are listed. */
function missingCredentialGroups(config: SocialConfig): { label: string; vars: string[] }[] {
  const byVars = new Map<string, { labels: string[]; vars: string[] }>()
  for (const p of ALL_PLATFORMS) {
    if (config.configured[p]) continue
    const key = config.env_vars[p].join('|')
    const entry = byVars.get(key) ?? { labels: [], vars: config.env_vars[p] }
    entry.labels.push(PLATFORMS[p].label)
    byVars.set(key, entry)
  }
  return [...byVars.values()].map(e => ({ label: e.labels.join(' / '), vars: e.vars }))
}

// ── Connection card ───────────────────────────────────────────────────────────

function ConnectionCard({
  platform, accounts, onConnect, onDisconnect, connecting, needsSetup = false,
}: {
  platform: Platform
  accounts: SocialAccount[]
  onConnect: (p: Platform) => void
  onDisconnect: (id: number) => void
  connecting: Platform | null
  /** OAuth credentials for this platform aren't configured — Connect would only open a JSON error. */
  needsSetup?: boolean
}) {
  const { label: name, color, hint } = PLATFORMS[platform]
  const connected = accounts.filter(a => a.platform === platform)
  const isConnecting = connecting === platform

  return (
    <div style={{ ...card, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: connected.length ? 12 : 0 }}>
        <PlatformIcon p={platform} size={36} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
        </div>
        <button
          onClick={() => onConnect(platform)}
          disabled={isConnecting || needsSetup}
          title={needsSetup ? 'Add this platform’s credentials first — see “Setup required” below' : undefined}
          style={{
            padding: '6px 14px', borderRadius: 6, border: `1px solid ${color}`,
            background: isConnecting || needsSetup ? 'transparent' : color,
            color: isConnecting || needsSetup ? color : '#fff',
            opacity: needsSetup ? 0.55 : 1,
            cursor: isConnecting || needsSetup ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {isConnecting ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Link2 size={12} />}
          {isConnecting ? 'Waiting…' : needsSetup ? 'Needs setup' : connected.length ? 'Add Account' : 'Connect'}
        </button>
      </div>

      {connected.map(acct => (
        <div key={acct.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 6 }}>
          <Check size={12} color="#22c55e" />
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>
            {acct.account_name}
            <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>({acct.account_type})</span>
          </span>
          {acct.token_expires_at && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              <Clock size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
              expires {acct.token_expires_at.slice(0, 10)}
            </span>
          )}
          <button onClick={() => onDisconnect(acct.id)} title="Disconnect" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
            <Unlink size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Post history row ──────────────────────────────────────────────────────────

function HistoryRow({ post }: { post: PostRecord }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <PlatformIcon p={post.platform as Platform} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word' }}>
          {post.content ? (post.content.length > 100 ? post.content.slice(0, 100) + '…' : post.content) : <em style={{ color: 'var(--text-muted)' }}>(no text)</em>}
        </div>
        {post.error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{post.error}</div>}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{post.created_at.slice(0, 16)}</div>
      </div>
      <span style={{
        fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
        background: post.status === 'published' ? 'rgba(34,197,94,0.15)' : post.status === 'failed' ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)',
        color: post.status === 'published' ? '#22c55e' : post.status === 'failed' ? '#ef4444' : '#9ca3af',
      }}>
        {post.status}
      </span>
    </div>
  )
}

// ── YouTube channel analytics ─────────────────────────────────────────────────

function YoutubeAnalyticsPanel({ data }: { data: YoutubeChannelAnalytics }) {
  const [sortBy, setSortBy] = useState<'views' | 'newest'>('views')

  if (data.error || !data.channel) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 6 }}>
          Channel Analytics — {data.account_name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>{data.error || 'Could not load analytics.'}</div>
      </div>
    )
  }

  const { channel, insights = {} } = data
  const videos = [...(data.videos ?? [])].sort((a, b) =>
    sortBy === 'views' ? b.views - a.views : b.published_at.localeCompare(a.published_at)
  )

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
        Channel Analytics — {channel.title}
      </div>
      <div style={{ display: 'flex', gap: 20, margin: '12px 0 14px' }}>
        <Stat label="Subscribers" value={channel.subscribers.toLocaleString()} />
        <Stat label="Total Views" value={channel.total_views.toLocaleString()} />
        <Stat label="Videos" value={String(channel.video_count)} />
      </div>

      {insights.note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', background: 'var(--surface2)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, lineHeight: 1.5 }}>
          {insights.note}
        </div>
      )}

      {insights.best_performer && (
        <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 12, lineHeight: 1.6 }}>
          <strong>Best performer:</strong> {insights.best_performer.title} ({insights.best_performer.views.toLocaleString()} views)
          {insights.worst_performer && (
            <><br /><strong>Lowest:</strong> {insights.worst_performer.title} ({insights.worst_performer.views.toLocaleString()} views)</>
          )}
          <br /><strong>Average:</strong> {insights.avg_views?.toLocaleString()} views · {insights.avg_likes?.toLocaleString()} likes per video
        </div>
      )}

      {videos.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['views', 'newest'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{
                fontSize: 10.5, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${sortBy === s ? 'var(--accent)' : 'var(--border)'}`,
                background: sortBy === s ? 'rgba(124,110,247,0.12)' : 'transparent',
                color: sortBy === s ? 'var(--accent)' : 'var(--text-muted)', fontWeight: sortBy === s ? 600 : 400,
              }}>
                Sort: {s === 'views' ? 'Most Views' : 'Newest'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {videos.map(v => (
              <div key={v.video_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {v.views.toLocaleString()} views · {v.likes.toLocaleString()} likes
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label: l, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
    </div>
  )
}

// ── YouTube auto-upload log ───────────────────────────────────────────────────

function YoutubeUploadRow({ u }: { u: YoutubeUpload }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word' }}>{u.title || u.filename}</div>
        {u.error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{u.error}</div>}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          {u.project_slug && <span style={{ fontWeight: 600, color: 'var(--text)' }}>{u.project_slug}</span>} {u.filename} · {u.created_at.slice(0, 16)}
        </div>
      </div>
      <span style={{
        fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, flexShrink: 0,
        background: u.status === 'published' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: u.status === 'published' ? '#22c55e' : '#ef4444',
      }}>
        {u.status}
      </span>
    </div>
  )
}

// ── Content projects (multi-channel/multi-series pipeline) ───────────────────

function ContentProjectsPanel({
  projects, youtubeAccounts, onLink,
}: {
  projects: ContentProject[]
  youtubeAccounts: SocialAccount[]
  onLink: (projectId: number, accountId: number | null) => void
}) {
  if (projects.length === 0) return null
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
        Content Projects
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Each project watches its own <code>incoming/</code> folder and publishes to whichever channel it's linked to below.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {projects.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 6, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2, wordBreak: 'break-all' }}>{p.base_dir}/incoming</div>
            </div>
            <select
              value={p.youtube_account_id ?? ''}
              onChange={e => onLink(p.id, e.target.value ? Number(e.target.value) : null)}
              style={{ ...inp, width: 'auto', fontSize: 11.5, padding: '5px 8px' }}
            >
              <option value="">— No channel linked —</option>
              {youtubeAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Social() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [posts, setPosts] = useState<PostRecord[]>([])
  const [connecting, setConnecting] = useState<Platform | null>(null)
  const popupRef = useRef<Window | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Composer state
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set())
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [posting, setPosting] = useState(false)
  const [postResults, setPostResults] = useState<PostResult[]>([])
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  // YouTube multi-project pipeline state
  const [projects, setProjects] = useState<ContentProject[]>([])
  const [ytChannels, setYtChannels] = useState<YoutubeChannelAnalytics[]>([])
  const [ytUploads, setYtUploads] = useState<YoutubeUpload[]>([])
  const [config, setConfig] = useState<SocialConfig | null>(null)

  async function fetchAll() {
    try {
      const [accts, history, projs, cfg] = await Promise.all([
        request<SocialAccount[]>('/social/accounts'),
        request<PostRecord[]>('/social/posts'),
        request<ContentProject[]>('/social/projects'),
        // Optional: an older backend without /social/config just gets the generic setup hint.
        request<SocialConfig>('/social/config').catch(() => null),
      ])
      setConfig(cfg)
      setAccounts(accts)
      setPosts(history)
      setProjects(projs)
      if (accts.some(a => a.platform === 'youtube')) {
        fetchYoutubeExtras()
      } else {
        setYtChannels([]); setYtUploads([])
      }
    } catch { /* backend down */ }
  }

  async function fetchYoutubeExtras() {
    try {
      const [analytics, uploads] = await Promise.all([
        request<{ channels: YoutubeChannelAnalytics[] }>('/social/youtube/analytics'),
        request<YoutubeUpload[]>('/social/youtube/uploads'),
      ])
      setYtChannels(analytics.channels)
      setYtUploads(uploads)
    } catch { /* not connected yet, or API error */ }
  }

  async function linkProject(projectId: number, accountId: number | null) {
    const form = new FormData()
    if (accountId !== null) form.append('account_id', String(accountId))
    await request(`/social/projects/${projectId}/link`, { method: 'POST', body: form })
    fetchAll()
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()

    // Listen for OAuth popup completing
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'oauth_complete') {
        setConnecting(null)
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        fetchAll()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
    // Mount-only: fetchAll is intentionally not a dep so this doesn't tear
    // down and re-subscribe the OAuth-popup message listener every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function connectPlatform(platform: Platform) {
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close()
    setConnecting(platform)
    setPostResults([])

    const popup = window.open(
      `/api/social/connect/${platform}`,
      `oauth_${platform}`,
      'width=600,height=700,left=200,top=100'
    )
    popupRef.current = popup

    // Poll in case postMessage doesn't fire (popup blocker, etc.)
    pollRef.current = setInterval(async () => {
      if (popup?.closed) {
        clearInterval(pollRef.current!)
        pollRef.current = null
        setConnecting(null)
        await fetchAll()
      }
    }, 1000)
  }

  async function disconnectAccount(id: number) {
    await request(`/social/accounts/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  function togglePlatform(p: Platform) {
    setSelectedPlatforms(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  const needsYoutube = selectedPlatforms.has('youtube')
  const needsInstagram = selectedPlatforms.has('instagram')
  const canPost = selectedPlatforms.size > 0 && (text || mediaUrl || imageFile) && !posting &&
    (!needsYoutube || videoFile) && (!needsInstagram || mediaUrl || imageFile)

  async function post() {
    if (!canPost) return
    setPosting(true); setPostResults([])
    const form = new FormData()
    form.append('platforms', JSON.stringify([...selectedPlatforms]))
    form.append('text', text)
    form.append('title', title)
    form.append('media_url', mediaUrl)
    if (imageFile) form.append('image', imageFile)
    if (videoFile) form.append('video', videoFile)
    try {
      const data = await request<{ results: PostResult[] }>('/social/post', { method: 'POST', body: form })
      setPostResults(data.results)
      if (data.results.some(r => r.status === 'published')) {
        setTimeout(() => { fetchAll() }, 1000)
      }
    } catch (e: unknown) {
      setPostResults([{ platform: 'all', account: '', status: 'failed', error: e instanceof Error ? e.message : String(e) }])
    }
    setPosting(false)
  }

  // Which platforms have a connected account
  const connected = new Set(accounts.map(a => a.platform))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>

      <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, alignItems: 'start' }}>

        {/* ── Left: Connections ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Connected Accounts</span>
            <button onClick={fetchAll} aria-label="Refresh accounts" title="Refresh accounts" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
              <RefreshCw size={13} />
            </button>
          </div>

          {ALL_PLATFORMS.map(p => (
            <ConnectionCard
              key={p}
              platform={p}
              accounts={accounts}
              onConnect={connectPlatform}
              onDisconnect={disconnectAccount}
              connecting={connecting}
              needsSetup={config ? !config.configured[p] : false}
            />
          ))}

          {config === null ? (
            <div style={{ ...card, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text)' }}>Setup required</strong><br />
              Connecting an account needs OAuth credentials from that platform, added to Arynwood’s <code>.env</code> file.
            </div>
          ) : missingCredentialGroups(config).length > 0 && (
            <div style={{ ...card, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text)' }}>Setup required</strong><br />
              Add these to <code style={{ wordBreak: 'break-all' }}>{config.env_file}</code>, then restart Arynwood:
              {missingCredentialGroups(config).map(g => (
                <div key={g.label} style={{ marginTop: 6 }}>
                  <span style={{ color: 'var(--text)' }}>{g.label}</span><br />
                  <code>{g.vars.join(' / ')}</code>
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                Register <code style={{ wordBreak: 'break-all' }}>{config.redirect_base}/api/social/callback/&lt;platform&gt;</code> as
                the redirect URI in each platform’s developer console.
              </div>
            </div>
          )}

          <ContentProjectsPanel
            projects={projects}
            youtubeAccounts={accounts.filter(a => a.platform === 'youtube')}
            onLink={linkProject}
          />
        </div>

        {/* ── Right: Composer + History ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {ytChannels.map(ch => <YoutubeAnalyticsPanel key={ch.account_id} data={ch} />)}

          {/* Composer */}
          <div style={card}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Share2 size={15} />
              New Post
            </div>

            {/* Platform selector */}
            <div style={{ marginBottom: 16 }}>
              <span style={label}>Post to</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ALL_PLATFORMS.map(p => {
                  const isSelected = selectedPlatforms.has(p)
                  const isConnected = connected.has(p)
                  const { color } = PLATFORMS[p]
                  return (
                    <button
                      key={p}
                      onClick={() => togglePlatform(p)}
                      title={isConnected ? undefined : 'Not connected'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 6,
                        border: `1px solid ${isSelected ? color : 'var(--border)'}`,
                        background: isSelected ? `${color}20` : 'var(--surface2)',
                        color: isSelected ? color : isConnected ? 'var(--text)' : 'var(--text-muted)',
                        cursor: 'pointer', fontSize: 12, fontWeight: isSelected ? 600 : 400,
                        opacity: isConnected ? 1 : 0.5,
                      }}
                    >
                      <PlatformIcon p={p} size={16} />
                      {PLATFORMS[p].label}
                      {!isConnected && <AlertCircle size={11} />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* YouTube title */}
            {needsYoutube && (
              <div style={{ marginBottom: 12 }}>
                <span style={label}>Video Title <span style={{ color: 'var(--danger)' }}>*</span></span>
                <input style={inp} type="text" placeholder="Required for YouTube" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} />
              </div>
            )}

            {/* Text */}
            <div style={{ marginBottom: 12 }}>
              <span style={label}>Caption / Text{needsInstagram && !mediaUrl && !imageFile ? '' : ''}</span>
              <textarea
                style={{ ...inp, minHeight: 100, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                placeholder={needsInstagram ? 'Caption for Instagram…' : 'What would you like to share?'}
                value={text}
                onChange={e => setText(e.target.value)}
                maxLength={needsYoutube ? 5000 : 2200}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
                {text.length} chars
              </div>
            </div>

            {/* Image URL */}
            {!needsYoutube && (
              <div style={{ marginBottom: 12 }}>
                <span style={label}>
                  Image URL
                  {needsInstagram && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>* (required for Instagram — must be publicly accessible)</span>}
                </span>
                <input style={inp} type="url" placeholder="https://example.com/image.jpg" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  Tip: upload to your web server via the <strong>Publish</strong> page and paste the public URL here.
                </div>
              </div>
            )}

            {/* Image file upload (alternative to URL, for Facebook/LinkedIn) */}
            {!needsYoutube && !mediaUrl && (
              <div style={{ marginBottom: 12 }}>
                <span style={label}>Or upload image {needsInstagram && '(URL preferred for Instagram)'}</span>
                <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => setImageFile(e.target.files?.[0] ?? null)} />
                <div
                  onClick={() => imageRef.current?.click()}
                  style={{ border: `1px dashed ${imageFile ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 14px', fontSize: 12, cursor: 'pointer', color: imageFile ? 'var(--text)' : 'var(--text-muted)', textAlign: 'center', background: imageFile ? 'rgba(124,110,247,0.06)' : 'transparent' }}
                >
                  {imageFile ? (
                    <span>{imageFile.name} <button onClick={e => { e.stopPropagation(); setImageFile(null) }} aria-label="Remove image" title="Remove image" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 6 }}><X size={11} /></button></span>
                  ) : (
                    <span><Upload size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Click to upload image</span>
                  )}
                </div>
              </div>
            )}

            {/* Video file upload (YouTube) */}
            {needsYoutube && (
              <div style={{ marginBottom: 12 }}>
                <span style={label}>Video File <span style={{ color: 'var(--danger)' }}>* (YouTube)</span></span>
                <input ref={videoRef} type="file" accept="video/*" style={{ display: 'none' }}
                  onChange={e => setVideoFile(e.target.files?.[0] ?? null)} />
                <div
                  onClick={() => videoRef.current?.click()}
                  style={{ border: `1px dashed ${videoFile ? '#ff0000' : 'var(--border)'}`, borderRadius: 8, padding: '10px 14px', fontSize: 12, cursor: 'pointer', color: videoFile ? 'var(--text)' : 'var(--text-muted)', textAlign: 'center', background: videoFile ? 'rgba(255,0,0,0.06)' : 'transparent' }}
                >
                  {videoFile ? (
                    <span>{videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB) <button onClick={e => { e.stopPropagation(); setVideoFile(null) }} aria-label="Remove video" title="Remove video" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 6 }}><X size={11} /></button></span>
                  ) : (
                    <span><Upload size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Click to select video</span>
                  )}
                </div>
              </div>
            )}

            {/* Post button */}
            <button
              disabled={!canPost}
              onClick={post}
              style={{
                width: '100%', padding: '10px', borderRadius: 8, border: 'none',
                background: canPost ? 'var(--accent)' : 'var(--surface2)', color: '#fff',
                cursor: canPost ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: canPost ? 1 : 0.5,
              }}
            >
              {posting ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
              {posting ? 'Publishing…' : `Post to ${selectedPlatforms.size || '…'} platform${selectedPlatforms.size !== 1 ? 's' : ''}`}
            </button>

            {/* Results */}
            {postResults.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {postResults.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderRadius: 6,
                    background: r.status === 'published' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${r.status === 'published' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    fontSize: 12,
                  }}>
                    {r.status === 'published'
                      ? <Check size={14} color="#22c55e" style={{ flexShrink: 0, marginTop: 1 }} />
                      : <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />}
                    <div>
                      <strong style={{ textTransform: 'capitalize' }}>{r.platform}</strong>
                      {r.account && ` · ${r.account}`}
                      {r.status === 'published' ? ' — Published' : ''}
                      {r.error && <div style={{ color: 'var(--danger)', marginTop: 2 }}>{r.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Post history */}
          {posts.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>Recent Posts</div>
              {posts.slice(0, 20).map(p => <HistoryRow key={p.id} post={p} />)}
            </div>
          )}

          {/* Auto-upload pipeline log */}
          {ytUploads.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>Auto-Upload Log</div>
              {ytUploads.slice(0, 20).map(u => <YoutubeUploadRow key={u.id} u={u} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
