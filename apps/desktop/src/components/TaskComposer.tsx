interface Props {
  task: string;
  onTaskChange: (value: string) => void;
  onRun: () => void;
  isRunning: boolean;
}

export function TaskComposer({ task, onTaskChange, onRun, isRunning }: Props) {
  return (
    <section className="panel">
      <h3>Task Composer</h3>
      <textarea value={task} onChange={(e) => onTaskChange(e.target.value)} rows={4} />
      <button onClick={onRun} disabled={isRunning}>{isRunning ? "Running..." : "Start Debate + Planning"}</button>
    </section>
  );
}
