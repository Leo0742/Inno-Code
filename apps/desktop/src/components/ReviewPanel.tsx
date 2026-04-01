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
  previewMode: "predicted" | "exact";
  exactPreviewReason: string;
  exactPreviewDiff: string;
  exactPreviewFiles: string[];
  exactPreviewValidationReport: string;
  selectedFiles: string[];
  onSelectedFilesChange: (files: string[]) => void;
  onGenerateExactPreview: () => void;
  onApply: () => void;
  onApplyAllExact: () => void;
  onApplySelectedExact: () => void;
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
  previewMode,
  exactPreviewReason,
  exactPreviewDiff,
  exactPreviewFiles,
  exactPreviewValidationReport,
  selectedFiles,
  onSelectedFilesChange,
  onGenerateExactPreview,
  onApply,
  onApplyAllExact,
  onApplySelectedExact,
  onDiscard
}: Props) {
  const parsedDiff = useMemo(() => parseDiffByFile(diff), [diff]);
  const [selectedDiffFile, setSelectedDiffFile] = useState("");
  const selectedPatch = parsedDiff.find((entry) => entry.filePath === selectedDiffFile)?.patch ?? parsedDiff[0]?.patch ?? "No applied diff yet.";
  const exactPreviewByFile = useMemo(() => parseDiffByFile(exactPreviewDiff), [exactPreviewDiff]);
  const [selectedExactPreviewFile, setSelectedExactPreviewFile] = useState("");
  const selectedExactPatch =
    exactPreviewByFile.find((entry) => entry.filePath === selectedExactPreviewFile)?.patch ?? exactPreviewByFile[0]?.patch ?? "No exact preview diff generated.";

  const toggleFile = (filePath: string) => {
    if (selectedFiles.includes(filePath)) {
      onSelectedFilesChange(selectedFiles.filter((entry) => entry !== filePath));
      return;
    }
    onSelectedFilesChange([...selectedFiles, filePath]);
  };

  return (
    <section className="panel">
      <h3>Review / Apply</h3>
      <p>
        Status: <strong>{status}</strong>
        {approvalRequired ? " (approval required)" : ""}
      </p>
      <div className="actions">
        <button disabled={!canApply} onClick={onGenerateExactPreview}>Generate Exact Preview</button>
        <button disabled={!canApply} onClick={onApply}>Apply Approved Plan (Legacy Full)</button>
        <button disabled={!canApply || previewMode !== "exact"} onClick={onApplyAllExact}>Apply All</button>
        <button disabled={!canApply || previewMode !== "exact" || selectedFiles.length === 0} onClick={onApplySelectedExact}>Apply Selected Files</button>
        <button disabled={!canApply} className="button-danger" onClick={onDiscard}>Discard Pending Plan</button>
      </div>
      {previewMode !== "exact" ? (
        <p className="helper">Selective apply is disabled until an exact sandbox preview is available. {exactPreviewReason}</p>
      ) : null}

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

      <h4>Exact Sandbox Preview</h4>
      <p>
        State:{" "}
        <strong>{previewMode === "exact" ? "exact sandbox preview (trusted pre-apply diff)" : "predicted only (exact unavailable)"}</strong>
      </p>
      {previewMode !== "exact" ? <pre>{exactPreviewReason || "Generate exact preview to unlock selective apply."}</pre> : null}
      {previewMode === "exact" ? (
        <>
          <h5>Exact Changed Files (Selectable)</h5>
          <ul className="file-list">
            {exactPreviewFiles.map((filePath) => (
              <li key={filePath}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedFiles.includes(filePath)}
                    onChange={() => toggleFile(filePath)}
                  />{" "}
                  {filePath}
                </label>
              </li>
            ))}
          </ul>
          <h5>Exact Sandbox Diff by File</h5>
          <div className="review-grid">
            <div>
              <ul className="file-list">
                {exactPreviewByFile.map((entry) => (
                  <li key={entry.filePath}>
                    <button
                      className={selectedExactPreviewFile === entry.filePath ? "button-secondary" : ""}
                      onClick={() => setSelectedExactPreviewFile(entry.filePath)}
                    >
                      {entry.filePath}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <pre>{selectedExactPatch}</pre>
            </div>
          </div>
          <h5>Exact Preview Validation Output</h5>
          <pre>{exactPreviewValidationReport || "No validation output for exact preview."}</pre>
        </>
      ) : null}

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
