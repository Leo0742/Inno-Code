export function ReviewPanel({ finalPlan, validationReport, diff }: { finalPlan: string; validationReport: string; diff: string }) {
  return (
    <section className="panel">
      <h3>Review</h3>
      <h4>Final Plan</h4>
      <pre>{finalPlan || "Final plan will appear after judge synthesis."}</pre>
      <h4>Validation</h4>
      <pre>{validationReport || "Validation output pending."}</pre>
      <h4>Repository Diff</h4>
      <pre>{diff || "No diff yet."}</pre>
    </section>
  );
}
