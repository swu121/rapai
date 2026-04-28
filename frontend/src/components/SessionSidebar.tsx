import type { StoredSession } from '../App'

type Props = {
  sessions: StoredSession[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onHome: () => void
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

export function SessionSidebar({ sessions, selectedId, onSelect, onDelete, onHome }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header sidebar-logo" onClick={onHome}>Rap AI</div>
      <div className="sidebar-sessions">
        {sessions.length === 0 && (
          <p className="sidebar-empty">No sessions yet</p>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            className={`sidebar-item${selectedId === s.id ? ' sidebar-item--active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="sidebar-item-title">{s.title}</div>
            <div className="sidebar-item-date">{formatDate(s.started_at)}</div>
            <button
              className="sidebar-item-delete"
              onClick={e => { e.stopPropagation(); onDelete(s.id) }}
              title="Delete session"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
