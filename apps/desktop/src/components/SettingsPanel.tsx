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
}

const roleOrder = ["architect", "critic", "implementer", "judge", "verifier"] as const;

export function SettingsPanel({ settings, onChange, onSave }: Props) {
  return (
    <section className="panel">
      <h3>Settings</h3>
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
      <p>Validation runs through shell commands; verifier model summarizes command results for review.</p>
    </section>
  );
}
