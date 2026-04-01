interface Settings {
  rounds: number;
  repairAttempts: number;
  approvalRequiredForApply: boolean;
  validationCommands: string[];
  roleModelMap: Record<string, string>;
}

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onSave: () => void;
  runtimeDiagnostics: {
    openClaudeCliAvailable: boolean;
    openClaudeVersion: string;
    providerConfigurationOwner: string;
    guidance: string[];
    lastRuntimeFailure: null | { at: string; message: string };
  } | null;
  onRefreshDiagnostics: () => void;
}

const roleOrder = ["architect", "critic", "implementer", "judge", "verifier"] as const;

export function SettingsPanel({ settings, onChange, onSave, runtimeDiagnostics, onRefreshDiagnostics }: Props) {
  return (
    <section className="panel">
      <h3>Settings</h3>
      <p className="helper">Inno Code settings below are stored locally. Provider keys/accounts are still configured in openclaude runtime outside this app.</p>
      <label>Rounds</label>
      <input type="number" value={settings.rounds} min={1} onChange={(e) => onChange({ ...settings, rounds: Number(e.target.value) })} />
      <label>Repair Attempts</label>
      <input type="number" value={settings.repairAttempts} min={0} onChange={(e) => onChange({ ...settings, repairAttempts: Number(e.target.value) })} />
      <h4>Role → Model Mapping</h4>
      {roleOrder.map((role) => (
        <div key={role}>
          <label>{role}</label>
          <input
            type="text"
            value={settings.roleModelMap[role] ?? ""}
            onChange={(e) =>
              onChange({
                ...settings,
                roleModelMap: {
                  ...settings.roleModelMap,
                  [role]: e.target.value
                }
              })
            }
          />
        </div>
      ))}
      <label>Validation Commands (one per line)</label>
      <textarea
        rows={4}
        value={settings.validationCommands.join("\n")}
        onChange={(e) => onChange({ ...settings, validationCommands: e.target.value.split("\n").filter(Boolean) })}
      />
      <label>
        <input
          type="checkbox"
          checked={settings.approvalRequiredForApply}
          onChange={(e) => onChange({ ...settings, approvalRequiredForApply: e.target.checked })}
        />
        Require explicit approval before apply
      </label>
      <button onClick={onSave}>Save Settings</button>
      <p className="helper">Managed in Inno Code: planning loops, model-per-role mapping, approval gate, validation commands.</p>
      <p className="helper">Managed in openclaude runtime: provider selection, API keys, account auth, remote runtime behavior.</p>
      <h4>Runtime Diagnostics</h4>
      <button onClick={onRefreshDiagnostics}>Refresh Diagnostics</button>
      {runtimeDiagnostics ? (
        <>
          <p className="helper">openclaude CLI available: <strong>{runtimeDiagnostics.openClaudeCliAvailable ? "yes" : "no"}</strong></p>
          <p className="helper">openclaude version/details: {runtimeDiagnostics.openClaudeVersion || "(unknown)"}</p>
          {runtimeDiagnostics.lastRuntimeFailure ? (
            <pre>Last runtime failure ({runtimeDiagnostics.lastRuntimeFailure.at}): {runtimeDiagnostics.lastRuntimeFailure.message}</pre>
          ) : (
            <p className="helper">No runtime failures captured in this app session.</p>
          )}
          <ul>
            {runtimeDiagnostics.guidance.map((item) => (
              <li key={item} className="helper">{item}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="helper">Diagnostics not loaded yet.</p>
      )}
    </section>
  );
}
