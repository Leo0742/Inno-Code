import { useMemo, useState } from "react";

interface Props {
  status: string;
  finalPlan: string;
  validationReport: string;
  diff: string;
  proposedDiff: string;
  predictedChangedFiles: string[];
  implementationChecklist: string[];
  approvalRequired: boolean;
  canApply: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

interface ParsedDiffFile {
  filePath: string;
  patch: string;
}

function parseDiffByFile(rawDiff: string): ParsedDiffFile[] {
  if (!rawDiff.trim() || rawDiff === "No applied diff yet." || rawDiff === "No diff generated.") return [];
  const lines = rawDiff.split("\n");
  const files: ParsedDiffFile[] = [];
  let currentFile = "(unknown file)";
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    files.push({ filePath: currentFile, patch: buffer.join("\n").trim() });
    buffer = [];
  };

  for (const line of lines) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      flush();
      currentFile = diffMatch[2];
    }
    buffer.push(line);
  }
  flush();
  return files;
}

export function ReviewPanel({
  status,
  finalPlan,
  validationReport,
  diff,
  proposedDiff,
  predictedChangedFiles,
  implementationChecklist,
  approvalRequired,
  canApply,
  onApply,
  onDiscard
}: Props) {
  const parsedDiff = useMemo(() => parseDiffByFile(diff), [diff]);
  const [selectedDiffFile, setSelectedDiffFile] = useState("");
  const selectedPatch = parsedDiff.find((entry) => entry.filePath === selectedDiffFile)?.patch ?? parsedDiff[0]?.patch ?? "No applied diff yet.";

  return (
    <section className="panel">
      <h3>Review / Apply</h3>
      <p>
        Status: <strong>{status}</strong>
        {approvalRequired ? " (approval required)" : ""}
      </p>
      <div className="actions">
        <button disabled={!canApply} onClick={onApply}>Apply Approved Plan</button>
        <button disabled={!canApply} className="button-danger" onClick={onDiscard}>Discard Pending Plan</button>
      </div>

      <h4>Final Plan</h4>
      <pre>{finalPlan || "Plan will appear after debate."}</pre>

      <h4>Pre-Apply Preview (Predicted Only)</h4>
      <p>Prediction only: this section is generated before execution and can differ from post-apply git diff.</p>
      <div className="review-grid">
        <div>
          <h5>Implementation Checklist (from plan)</h5>
          {implementationChecklist.length ? (
            <ul>
              {implementationChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No checklist extracted from final plan.</p>
          )}
        </div>
        <div>
          <h5>Predicted Changed Files</h5>
          {predictedChangedFiles.length ? (
            <ul>
              {predictedChangedFiles.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : (
            <p>No file list detected in predicted diff output.</p>
          )}
        </div>
      </div>
      <h5>Predicted Patch Text</h5>
      <pre>{proposedDiff || "No proposed diff yet."}</pre>

      <h4>Post-Apply Results (Source of Truth)</h4>
      <h5>Validation Output</h5>
      <pre>{validationReport || "Validation output appears after apply."}</pre>

      <h5>Applied Git Diff by File</h5>
      {parsedDiff.length > 0 ? (
        <div className="review-grid">
          <div>
            <ul className="file-list">
              {parsedDiff.map((entry) => (
                <li key={entry.filePath}>
                  <button
                    className={selectedDiffFile === entry.filePath ? "button-secondary" : ""}
                    onClick={() => setSelectedDiffFile(entry.filePath)}
                  >
                    {entry.filePath}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <pre>{selectedPatch}</pre>
          </div>
        </div>
      ) : (
        <pre>{diff || "No applied diff yet."}</pre>
      )}
    </section>
  );
}
