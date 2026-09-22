import { LockKeyhole, ExternalLink } from 'lucide-react'
import { PageShell } from '../ui/PageShell'
import { EmptyState } from '../ui/EmptyState'
import { buttonVariants } from '../ui/variants'
import { cn } from '../../lib/cn'

const REPO_URL = 'https://github.com/Arynwood-Technology/ArynwoodMCP'

/** Shown in place of a page that inherently needs a real backend/OS-level access
 *  (SFTP, OAuth, GPU jobs, launching native desktop apps) — honest rather than faked. */
export function DemoUnavailable({ feature, reason }: { feature: string; reason: string }) {
  return (
    <PageShell>
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<LockKeyhole size={28} />}
          title={`${feature} isn't part of this demo`}
          description={`${feature} needs ${reason} — this static demo has no backend to talk to.`}
          action={
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
            >
              Get the real thing on GitHub <ExternalLink size={12} />
            </a>
          }
        />
      </div>
    </PageShell>
  )
}
