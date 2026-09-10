// Compact, sortable timestamp for download filenames — the job-file
// endpoints all serve from a URL ending in /file, which browsers otherwise
// use verbatim as the downloaded filename ("file", no extension).
export function timestampSlug(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
