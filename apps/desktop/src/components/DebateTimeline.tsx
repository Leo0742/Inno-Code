export function DebateTimeline({ grouped }: { grouped: Record<string, Array<{ role: string; content: string }>> }) {
  const phases = ["proposal", "critique", "revision", "verdict", "validation", "repair"];
  return (
    <section className="panel">
      <h3>Debate View</h3>
      {phases.map((phase) => (
        <div key={phase}>
          <h4>{phase}</h4>
          {(grouped[phase] ?? []).map((m, idx) => (
            <article key={`${phase}-${idx}`} className="message">
              <strong>{m.role}</strong>
              <p>{m.content}</p>
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}
