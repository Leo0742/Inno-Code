import { useEffect, useMemo, useState } from "react";
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

interface AppSettings {
  rounds: number;
  repairAttempts: number;
  approvalRequiredForApply: boolean;
  validationCommands: string[];
  roleModelMap: Record<string, string>;
}

const defaultSettings: AppSettings = {
  rounds: 3,
  repairAttempts: 1,
  approvalRequiredForApply: true,
  validationCommands: ["npm test", "npm run typecheck", "npm run build"],
  roleModelMap: {
    architect: "gpt-4.1",
    critic: "gpt-4.1-mini",
    implementer: "gpt-4.1",
    judge: "gpt-4.1",
    verifier: "gpt-4.1-mini"
  }
};

export function App() {
  const [projectPath, setProjectPath] = useState("");
  const [task, setTask] = useState("Implement provider settings and validation.");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [finalPlan, setFinalPlan] = useState("");
  const [validationReport, setValidationReport] = useState("");
  const [diff, setDiff] = useState("");
  const [proposedDiff, setProposedDiff] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState("idle");
  const [sessionId, setSessionId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    window.innoCode.getSettings().then((saved) => setSettings(saved));
  }, []);

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
    if (!projectPath || isRunning) {
      setLogs((p) => [...p, "Choose a project path and wait for current run to finish."]);
      return;
    }

    setIsRunning(true);
    setStatus("planning");
    setValidationReport("");
    setDiff("");
    try {
      const result = await window.innoCode.runPlan({ task, projectPath });
      setLogs(result.logs);
      setMessages(result.messages);
      setFinalPlan(result.finalPlan);
      setProposedDiff(result.proposedDiff);
      setSessionId(result.sessionId);
      setStatus(result.status);
    } catch (error) {
      setStatus("error");
      setLogs((prev) => [...prev, `Planning failed: ${String(error)}`]);
    } finally {
      setIsRunning(false);
    }
  }

  async function handleApply() {
    if (!sessionId || isRunning) return;
    setIsRunning(true);
    setStatus("applying");
    try {
      const result = await window.innoCode.applyPlan({ sessionId, approved: true });
      setLogs((prev) => [...prev, ...result.logs]);
      setMessages((prev) => [...prev, ...result.messages]);
      setValidationReport(result.validationReport);
      setDiff(result.diff);
      setStatus(result.status);
      setSessionId("");
    } catch (error) {
      setStatus("error");
      setLogs((prev) => [...prev, `Apply failed: ${String(error)}`]);
    } finally {
      setIsRunning(false);
    }
  }

  async function handleDiscard() {
    if (!sessionId) return;
    await window.innoCode.discardPlan({ sessionId });
    setSessionId("");
    setStatus("discarded");
    setFinalPlan("");
    setProposedDiff("");
    setMessages([]);
  }

  async function handleSaveSettings() {
    const saved = await window.innoCode.saveSettings(settings);
    setSettings(saved);
    setLogs((prev) => [...prev, "Settings saved."]);
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Inno Code</h2>
        <button onClick={chooseProject}>Open Project Folder</button>
        <p>{projectPath || "No project selected."}</p>
        <SettingsPanel settings={settings} onChange={setSettings} onSave={handleSaveSettings} />
      </aside>
      <main className="main">
        <TaskComposer task={task} onTaskChange={setTask} onRun={handleRun} isRunning={isRunning} />
        <DebateTimeline grouped={grouped} />
        <ReviewPanel
          status={status}
          finalPlan={finalPlan}
          validationReport={validationReport}
          diff={diff}
          proposedDiff={proposedDiff}
          approvalRequired={settings.approvalRequiredForApply}
          canApply={Boolean(sessionId) && !isRunning}
          onApply={handleApply}
          onDiscard={handleDiscard}
        />
      </main>
      <section className="logs">
        <LogsPanel entries={logs} />
      </section>
    </div>
  );
}
