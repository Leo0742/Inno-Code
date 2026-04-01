interface Props {
  status: string;
  finalPlan: string;
  validationReport: string;
  diff: string;
  proposedDiff: string;
  approvalRequired: boolean;
  canApply: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

export function ReviewPanel({ status, finalPlan, validationReport, diff, proposedDiff, approvalRequired, canApply, onApply, onDiscard }: Props) {
  return (
    <section className="panel">
      <h3>Review / Apply</h3>
      <p>Status: <strong>{status}</strong>{approvalRequired ? " (approval required)" : ""}</p>
      <button disabled={!canApply} onClick={onApply}>Apply Approved Plan</button>
      <button disabled={!canApply} onClick={onDiscard}>Discard Pending Plan</button>
      <h4>Final Plan</h4>
      <pre>{finalPlan || "Plan will appear after debate."}</pre>
      <h4>Proposed Diff (pre-apply)</h4>
      <pre>{proposedDiff || "No proposed diff yet."}</pre>
      <h4>Validation</h4>
      <pre>{validationReport || "Validation output appears after apply."}</pre>
      <h4>Repository Diff (applied)</h4>
      <pre>{diff || "No applied diff yet."}</pre>
    </section>
  );
}
