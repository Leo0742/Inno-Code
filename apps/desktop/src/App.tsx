import { useMemo, useState } from "react";
import { DebateTimeline } from "./components/DebateTimeline";
import { LogsPanel } from "./components/LogsPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TaskComposer } from "./components/TaskComposer";

export interface DebateMessage {
  role: string;
  phase: string;
  round: number;
  model: string;
  content: string;
}

export function App() {
  const [projectPath, setProjectPath] = useState("");
  const [task, setTask] = useState("Implement provider settings and validation.");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [finalPlan, setFinalPlan] = useState("");
  const [validationReport, setValidationReport] = useState("");
  const [diff, setDiff] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const grouped = useMemo(() => {
    return messages.reduce<Record<string, DebateMessage[]>>((acc, m) => {
      acc[m.phase] ??= [];
      acc[m.phase].push(m);
      return acc;
    }, {});
  }, [messages]);

  async function chooseProject() {
    const selected = await window.innoCode.pickProject();
    if (selected) setProjectPath(selected);
  }

  async function handleRun() {
    if (!projectPath) {
      setLogs((p) => [...p, "Choose a project path first."]);
      return;
    }

    const result = await window.innoCode.runDebate({
      task,
      projectPath,
      roleModelMap: {
        architect: "gpt-4.1",
        critic: "gpt-4.1-mini",
        implementer: "gpt-4.1",
        judge: "gpt-4.1",
        verifier: "gpt-4.1-mini"
      },
      validationCommands: ["npm test", "npm run typecheck", "npm run build"]
    });

    setLogs(result.logs);
    setMessages(result.messages);
    setFinalPlan(result.finalPlan);
    setValidationReport(result.validationReport);
    setDiff(result.diff);
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Inno Code</h2>
        <button onClick={chooseProject}>Open Project Folder</button>
        <p>{projectPath || "No project selected."}</p>
        <SettingsPanel />
      </aside>
      <main className="main">
        <TaskComposer task={task} onTaskChange={setTask} onRun={handleRun} />
        <DebateTimeline grouped={grouped} />
        <ReviewPanel finalPlan={finalPlan} validationReport={validationReport} diff={diff} />
      </main>
      <section className="logs">
        <LogsPanel entries={logs} />
      </section>
    </div>
  );
}
