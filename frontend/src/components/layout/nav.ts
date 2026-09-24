import {
  LayoutDashboard, MessageSquare, Cpu, Server,
  Wrench, Upload, Palette, Brain, Music2, Share2, Clapperboard, Users,
  type LucideIcon,
} from 'lucide-react'

/** `also`: other routes that belong to this destination, so it stays highlighted while you're on them. */
export type NavLeaf = { to: string; icon: LucideIcon; label: string; also?: string[] }
export type NavItem =
  | ({ kind?: 'link' } & NavLeaf)
  | { kind: 'group'; icon: LucideIcon; label: string; children: NavLeaf[] }

export const NAV: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  {
    kind: 'group', icon: MessageSquare, label: 'Chat, Models & Servers',
    children: [
      { to: '/chat',      icon: MessageSquare, label: 'Chat'      },
      { to: '/knowledge', icon: Brain,         label: 'Knowledge' },
      { to: '/models',    icon: Cpu,           label: 'Models'    },
      { to: '/servers',   icon: Server,        label: 'Servers'   },
    ],
  },
  { to: '/publish', icon: Upload,       label: 'Publish'       },
  { to: '/tools',   icon: Wrench,       label: 'Tools'         },
  { to: '/design',  icon: Palette,      label: 'Design Center' },
  // /dj (the DJ Toolkit) is a tool reached from this page, deliberately not a sidebar entry of its own.
  { to: '/studio',  icon: Music2,       label: 'Music', also: ['/dj'] },
  { to: '/video',   icon: Clapperboard, label: 'Video Studio'  },
  { to: '/social',  icon: Share2,       label: 'Social Media'  },
  { to: '/community', icon: Users,      label: 'Community'     },
]

/** Every reachable destination, flattened — the command palette searches this so
 *  a page added to NAV shows up there with no second list to maintain. */
export const NAV_DESTINATIONS: NavLeaf[] = NAV.flatMap(item =>
  item.kind === 'group' ? item.children : [item],
)
