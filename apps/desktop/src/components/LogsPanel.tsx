export function LogsPanel({ entries }: { entries: string[] }) {
  return (
    <div className="panel logs-panel">
      <h3>Logs / Output</h3>
      <ul>
        {entries.map((entry, i) => (
          <li key={`${entry}-${i}`}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}
