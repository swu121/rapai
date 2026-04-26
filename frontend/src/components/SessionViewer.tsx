import type { StoredSession } from '../App'

type Props = {
  session: StoredSession
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function duration(start: string, end: string) {
  const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function SessionViewer({ session }: Props) {
  return (
    <div className="session-viewer">
      <h2 className="session-viewer-title">{session.title}</h2>
      <div className="session-meta">
        {formatDate(session.started_at)} &nbsp;·&nbsp; {duration(session.started_at, session.ended_at)}
      </div>
      <div className="session-transcript">
        {session.transcript || <em>No transcript recorded.</em>}
      </div>
    </div>
  )
}
