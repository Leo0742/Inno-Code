import { useEffect, useMemo, useState } from "react";
import { DebateTimeline } from "./components/DebateTimeline";
import { LogsPanel } from "./components/LogsPanel";
import { PendingSessionsPanel } from "./components/PendingSessionsPanel";
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

function deriveStatusFromEvent(type: string, phase?: string): string | null {
  if (type === "error_event") return "error";
  if (phase === "validation") return "validating";
  if (phase === "repair") return "repairing";
  if (phase === "verdict") return "planning_verdict";
  if (phase === "proposal" || phase === "critique" || phase === "revision") return "planning";
  return null;
}

function isRuntimeEventForActiveStream(activeStreamId: string, incomingStreamId: string) {
  return Boolean(activeStreamId) && activeStreamId === incomingStreamId;
}

function createClientStreamId(prefix: "plan" | "apply") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const [projectPath, setProjectPath] = useState("");
  const [task, setTask] = useState("Implement provider settings and validation.");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [finalPlan, setFinalPlan] = useState("");
  const [validationReport, setValidationReport] = useState("");
  const [diff, setDiff] = useState("");
  const [proposedDiff, setProposedDiff] = useState("");
  const [predictedChangedFiles, setPredictedChangedFiles] = useState<string[]>([]);
  const [implementationChecklist, setImplementationChecklist] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState("idle");
  const [sessionId, setSessionId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [activeStreamId, setActiveStreamId] = useState("");
  const [pendingSessions, setPendingSessions] = useState<PendingPlanSession[]>([]);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<{
    openClaudeCliAvailable: boolean;
    openClaudeVersion: string;
    providerConfigurationOwner: string;
    guidance: string[];
    lastRuntimeFailure: null | { at: string; message: string };
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<"predicted" | "exact">("predicted");
  const [exactPreviewReason, setExactPreviewReason] = useState("");
  const [exactPreviewDiff, setExactPreviewDiff] = useState("");
  const [exactPreviewFiles, setExactPreviewFiles] = useState<string[]>([]);
  const [exactPreviewValidationReport, setExactPreviewValidationReport] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  async function refreshPendingSessions() {
    const sessions = await window.innoCode.getPendingPlans();
    setPendingSessions(sessions);
  }

  useEffect(() => {
    window.innoCode.getSettings().then((saved) => setSettings(saved));
    refreshPendingSessions();
    window.innoCode.getRuntimeDiagnostics().then((diagnostics) => setRuntimeDiagnostics(diagnostics));

    const unsubscribe = window.innoCode.onRuntimeEvent((payload) => {
      if (!isRuntimeEventForActiveStream(activeStreamId, payload.streamId)) return;
      const line = `[${payload.event.type}] ${payload.event.message}`;
      setLogs((prev) => [...prev, line]);
      const nextStatus = deriveStatusFromEvent(payload.event.type, payload.event.phase);
      if (nextStatus) setStatus(nextStatus);
    });
    return () => unsubscribe();
  }, [activeStreamId]);

  const grouped = useMemo(() => {
    return messages.reduce<Record<string, DebateMessage[]>>((acc, m) => {
      acc[m.phase] ??= [];
      acc[m.phase].push(m);
      return acc;
    }, {});
  }, [messages]);

  function loadPendingSession(loadedSessionId: string) {
    const selected = pendingSessions.find((session) => session.sessionId === loadedSessionId);
    if (!selected) return;
    setSessionId(selected.sessionId);
    setTask(selected.task);
    setProjectPath(selected.projectPath);
    setFinalPlan(selected.finalPlan);
    setProposedDiff(selected.proposedDiff ?? "");
    setPredictedChangedFiles(selected.predictedChangedFiles ?? []);
    setImplementationChecklist(selected.implementationChecklist ?? []);
    setValidationReport("");
    setDiff("");
    setStatus("pending_review");
    const exactPreview = selected.exactPreview;
    if (exactPreview?.exactPreviewAvailable) {
      setPreviewMode("exact");
      setExactPreviewReason("");
      setExactPreviewDiff(exactPreview.diff);
      setExactPreviewFiles(exactPreview.changedFiles ?? []);
      setExactPreviewValidationReport(exactPreview.validationReport ?? "");
      setSelectedFiles(exactPreview.changedFiles ?? []);
    } else {
      setPreviewMode("predicted");
      setExactPreviewReason(exactPreview?.reason ?? "");
      setExactPreviewDiff("");
      setExactPreviewFiles([]);
      setExactPreviewValidationReport("");
      setSelectedFiles([]);
    }
    setLogs((prev) => [...prev, `Loaded pending review session ${selected.sessionId}.`]);
  }

  async function chooseProject() {
    const selected = await window.innoCode.pickProject();
    if (selected) setProjectPath(selected);
  }

  async function handleRun() {
    if (!projectPath || isRunning) {
      setLogs((p) => [...p, "Choose a project path and wait for current run to finish."]);
      return;
    }

    const streamId = createClientStreamId("plan");
    setActiveStreamId(streamId);
    setIsRunning(true);
    setStatus("planning");
    setValidationReport("");
    setDiff("");
    setPreviewMode("predicted");
    setExactPreviewReason("");
    setExactPreviewDiff("");
    setExactPreviewFiles([]);
    setExactPreviewValidationReport("");
    setSelectedFiles([]);
    setLogs([]);
    try {
      const result = await window.innoCode.runPlan({ task, projectPath, streamId });
      setMessages(result.messages);
      setFinalPlan(result.finalPlan);
      setProposedDiff(result.proposedDiff);
      setPredictedChangedFiles(result.predictedChangedFiles);
      setImplementationChecklist(result.implementationChecklist);
      setSessionId(result.sessionId);
      setStatus(result.status);
      await refreshPendingSessions();
    } catch (error) {
      const message = String(error);
      if (message.includes("cancelled")) {
        setStatus("cancelled");
        setLogs((prev) => [...prev, "Planning was cancelled by user."]);
      } else {
        setStatus("error");
        setLogs((prev) => [...prev, `Planning failed: ${message}`]);
      }
    } finally {
      setIsRunning(false);
      setActiveStreamId("");
    }
  }

  async function handleApply() {
    if (!sessionId || isRunning) return;
    await runApply("runtime_full");
  }

  async function runApply(applyMode: "runtime_full" | "exact_all" | "exact_selected") {
    if (!sessionId || isRunning) return;
    const streamId = createClientStreamId("apply");
    setActiveStreamId(streamId);
    setIsRunning(true);
    setStatus("applying");
    try {
      const result = await window.innoCode.applyPlan({
        sessionId,
        approved: true,
        streamId,
        applyMode,
        selectedFiles: applyMode === "exact_selected" ? selectedFiles : undefined
      });
      setMessages((prev) => [...prev, ...result.messages]);
      setValidationReport(result.validationReport);
      setDiff(result.diff);
      setStatus(result.status);
      setSessionId("");
      await refreshPendingSessions();
    } catch (error) {
      const message = String(error);
      if (message.includes("cancelled")) {
        setStatus("cancelled");
        setLogs((prev) => [...prev, "Apply/validation run was cancelled by user."]);
      } else {
        setStatus("error");
        setLogs((prev) => [...prev, `Apply failed: ${message}`]);
      }
    } finally {
      setIsRunning(false);
      setActiveStreamId("");
    }
  }

  async function handleGenerateExactPreview() {
    if (!sessionId || isRunning) return;
    const streamId = createClientStreamId("plan");
    setActiveStreamId(streamId);
    setIsRunning(true);
    setStatus("generating_exact_preview");
    try {
      const result = await window.innoCode.generateExactPreview({ sessionId, streamId });
      if (result.exactPreviewAvailable) {
        setPreviewMode("exact");
        setExactPreviewReason("");
        setExactPreviewDiff(result.diff);
        setExactPreviewFiles(result.changedFiles);
        setExactPreviewValidationReport(result.validationReport);
        setSelectedFiles(result.changedFiles);
        setStatus("exact_preview_ready");
      } else {
        setPreviewMode("predicted");
        setExactPreviewReason(result.reason ?? "Exact preview unavailable.");
        setExactPreviewDiff("");
        setExactPreviewFiles([]);
        setExactPreviewValidationReport("");
        setSelectedFiles([]);
        setStatus("exact_preview_unavailable");
      }
      await refreshPendingSessions();
    } catch (error) {
      setStatus("error");
      setLogs((prev) => [...prev, `Exact preview failed: ${String(error)}`]);
    } finally {
      setIsRunning(false);
      setActiveStreamId("");
    }
  }

  async function handleCancelRun() {
    if (!activeStreamId || !isRunning) return;
    const cancelledStreamId = activeStreamId;
    await window.innoCode.cancelRun({ streamId: cancelledStreamId });
    setStatus("cancelled");
    setIsRunning(false);
    setActiveStreamId("");
    setLogs((prev) => [...prev, `Run ${cancelledStreamId} cancelled by user.`]);
  }

  async function handleDiscard() {
    if (!sessionId) return;
    await window.innoCode.discardPlan({ sessionId });
    setSessionId("");
    setStatus("discarded");
    setFinalPlan("");
    setProposedDiff("");
    setPredictedChangedFiles([]);
    setImplementationChecklist([]);
    setMessages([]);
    setPreviewMode("predicted");
    setExactPreviewReason("");
    setExactPreviewDiff("");
    setExactPreviewFiles([]);
    setExactPreviewValidationReport("");
    setSelectedFiles([]);
    await refreshPendingSessions();
  }

  async function handleDeletePendingSession(targetSessionId: string) {
    await window.innoCode.discardPlan({ sessionId: targetSessionId });
    if (targetSessionId === sessionId) {
      setSessionId("");
      setStatus("discarded");
    }
    await refreshPendingSessions();
  }

  async function handleSaveSettings() {
    const saved = await window.innoCode.saveSettings(settings);
    setSettings(saved);
    setLogs((prev) => [...prev, "Settings saved."]);
  }

  async function refreshRuntimeDiagnostics() {
    const diagnostics = await window.innoCode.getRuntimeDiagnostics();
    setRuntimeDiagnostics(diagnostics);
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Inno Code</h2>
        <button onClick={chooseProject}>Open Project Folder</button>
        <p>{projectPath || "No project selected."}</p>
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onSave={handleSaveSettings}
          runtimeDiagnostics={runtimeDiagnostics}
          onRefreshDiagnostics={refreshRuntimeDiagnostics}
        />
      </aside>
      <main className="main">
        <TaskComposer task={task} onTaskChange={setTask} onRun={handleRun} onCancel={handleCancelRun} isRunning={isRunning} />
        <PendingSessionsPanel
          sessions={pendingSessions}
          activeSessionId={sessionId}
          onOpen={loadPendingSession}
          onDelete={handleDeletePendingSession}
        />
        <DebateTimeline grouped={grouped} />
        <ReviewPanel
          status={status}
          finalPlan={finalPlan}
          validationReport={validationReport}
          diff={diff}
          proposedDiff={proposedDiff}
          predictedChangedFiles={predictedChangedFiles}
          implementationChecklist={implementationChecklist}
          approvalRequired={settings.approvalRequiredForApply}
          canApply={Boolean(sessionId) && !isRunning}
          previewMode={previewMode}
          exactPreviewReason={exactPreviewReason}
          exactPreviewDiff={exactPreviewDiff}
          exactPreviewFiles={exactPreviewFiles}
          exactPreviewValidationReport={exactPreviewValidationReport}
          selectedFiles={selectedFiles}
          onSelectedFilesChange={setSelectedFiles}
          onGenerateExactPreview={handleGenerateExactPreview}
          onApply={handleApply}
          onApplyAllExact={() => runApply("exact_all")}
          onApplySelectedExact={() => runApply("exact_selected")}
          onDiscard={handleDiscard}
        />
      </main>
      <section className="logs">
        <LogsPanel entries={logs} />
      </section>
    </div>
  );
}
