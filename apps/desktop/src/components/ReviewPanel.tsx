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
  return (
    <section className="panel">
      <h3>Review / Apply</h3>
      <p>
        Status: <strong>{status}</strong>
        {approvalRequired ? " (approval required)" : ""}
      </p>
      <button disabled={!canApply} onClick={onApply}>Apply Approved Plan</button>
      <button disabled={!canApply} onClick={onDiscard}>Discard Pending Plan</button>

      <h4>Final Plan</h4>
      <pre>{finalPlan || "Plan will appear after debate."}</pre>

      <h4>Pre-Apply Preview (Predicted)</h4>
      <p>This preview is model-generated and may differ from what is actually applied.</p>
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
      <h5>Predicted Patch Text</h5>
      <pre>{proposedDiff || "No proposed diff yet."}</pre>

      <h4>Post-Apply Results (Source of Truth)</h4>
      <h5>Validation</h5>
      <pre>{validationReport || "Validation output appears after apply."}</pre>
      <h5>Applied Git Diff</h5>
      <pre>{diff || "No applied diff yet."}</pre>
    </section>
  );
}
