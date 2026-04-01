interface Props {
  task: string;
  onTaskChange: (value: string) => void;
  onRun: () => void;
}

export function TaskComposer({ task, onTaskChange, onRun }: Props) {
  return (
    <section className="panel">
      <h3>Task Composer</h3>
      <textarea value={task} onChange={(e) => onTaskChange(e.target.value)} rows={4} />
      <button onClick={onRun}>Start Real Debate + Execution</button>
    </section>
  );
}
