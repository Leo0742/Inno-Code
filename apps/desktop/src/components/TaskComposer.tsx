interface Props {
  task: string;
  onTaskChange: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  isRunning: boolean;
}

export function TaskComposer({ task, onTaskChange, onRun, onCancel, isRunning }: Props) {
  return (
    <section className="panel">
      <h3>Task Composer</h3>
      <textarea value={task} onChange={(e) => onTaskChange(e.target.value)} rows={4} />
      <div className="actions">
        <button onClick={onRun} disabled={isRunning}>{isRunning ? "Running..." : "Start Debate + Planning"}</button>
        <button className="button-secondary" onClick={onCancel} disabled={!isRunning}>Cancel Active Run</button>
      </div>
    </section>
  );
}
