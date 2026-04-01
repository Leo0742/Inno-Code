interface PendingSession {
  sessionId: string;
  task: string;
  projectPath: string;
  createdAt?: string;
}

interface Props {
  sessions: PendingSession[];
  activeSessionId: string;
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

function formatDate(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function PendingSessionsPanel({ sessions, activeSessionId, onOpen, onDelete }: Props) {
  return (
    <section className="panel">
      <h3>Pending Sessions</h3>
      <p>Choose which persisted pending review session to load. Sessions are local to this machine.</p>
      {sessions.length === 0 ? (
        <p>No pending review sessions saved.</p>
      ) : (
        <ul className="pending-list">
          {sessions
            .slice()
            .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
            .map((session) => {
              const isActive = session.sessionId === activeSessionId;
              return (
                <li key={session.sessionId} className="pending-item">
                  <p><strong>ID:</strong> {session.sessionId}</p>
                  <p><strong>Task:</strong> {session.task}</p>
                  <p><strong>Project:</strong> {session.projectPath}</p>
                  <p><strong>Created:</strong> {formatDate(session.createdAt)}</p>
                  <p><strong>Status:</strong> pending review</p>
                  <div className="actions">
                    <button disabled={isActive} onClick={() => onOpen(session.sessionId)}>
                      {isActive ? "Loaded" : "Open"}
                    </button>
                    <button className="button-danger" onClick={() => onDelete(session.sessionId)}>Discard</button>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}
