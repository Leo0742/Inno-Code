import { useMemo, useState } from "react";

interface Settings {
  rounds: number;
  repairAttempts: number;
  approvalRequiredForApply: boolean;
  validationCommands: string[];
  roleModelMap: Record<string, string>;
  providerProfiles: ProviderProfile[];
  roleModelSelections: Record<string, RoleModelSelection>;
}

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onSave: () => void;
  runtimeDiagnostics: any;
  onRefreshDiagnostics: () => void;
}

const roleOrder = ["architect", "critic", "implementer", "judge", "verifier"] as const;

export function SettingsPanel({ settings, onChange, onSave, runtimeDiagnostics, onRefreshDiagnostics }: Props) {
  const [activeProviderId, setActiveProviderId] = useState(settings.providerProfiles[0]?.id ?? "");
  const activeProfile = useMemo(() => settings.providerProfiles.find((item) => item.id === activeProviderId) ?? settings.providerProfiles[0], [settings.providerProfiles, activeProviderId]);

  async function handleSaveCredential(secret: string) {
    if (!activeProfile || !secret.trim()) return;
    await window.innoCode.setCredential({ credentialRef: activeProfile.credentialRef, secret: secret.trim() });
    onRefreshDiagnostics();
  }

  async function handleDeleteCredential() {
    if (!activeProfile) return;
    await window.innoCode.deleteCredential({ credentialRef: activeProfile.credentialRef });
    onRefreshDiagnostics();
  }

  function updateProvider(next: Partial<ProviderProfile>) {
    if (!activeProfile) return;
    onChange({
      ...settings,
      providerProfiles: settings.providerProfiles.map((item) =>
        item.id === activeProfile.id ? { ...item, ...next, updatedAt: new Date().toISOString() } : item
      )
    });
  }

  function addProvider() {
    const id = `provider-${Date.now()}`;
    const profile: ProviderProfile = {
      id,
      displayName: `Provider ${settings.providerProfiles.length + 1}`,
      providerType: "openai_compatible",
      endpoint: "",
      credentialRef: `provider:${id}`,
      organization: "",
      project: "",
      extraHeaders: {},
      modelPresets: {},
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onChange({ ...settings, providerProfiles: [...settings.providerProfiles, profile] });
    setActiveProviderId(id);
  }

  function deleteProvider(id: string) {
    const nextProfiles = settings.providerProfiles.filter((item) => item.id !== id);
    onChange({ ...settings, providerProfiles: nextProfiles });
    setActiveProviderId(nextProfiles[0]?.id ?? "");
  }

  return (
    <section className="panel">
      <h3>Settings</h3>
      <label>Rounds</label>
      <input type="number" value={settings.rounds} min={1} onChange={(e) => onChange({ ...settings, rounds: Number(e.target.value) })} />
      <label>Repair Attempts</label>
      <input type="number" value={settings.repairAttempts} min={0} onChange={(e) => onChange({ ...settings, repairAttempts: Number(e.target.value) })} />

      <h4>Provider Profiles</h4>
      <button onClick={addProvider}>Add Provider</button>
      {settings.providerProfiles.map((profile) => (
        <div key={profile.id}>
          <button onClick={() => setActiveProviderId(profile.id)}>{profile.displayName}</button>
          <button onClick={() => deleteProvider(profile.id)}>Delete</button>
        </div>
      ))}

      {activeProfile ? (
        <div>
          <label>Provider Name</label>
          <input type="text" value={activeProfile.displayName} onChange={(e) => updateProvider({ displayName: e.target.value })} />
          <label>Provider Type</label>
          <select value={activeProfile.providerType} onChange={(e) => updateProvider({ providerType: e.target.value as ProviderProfile["providerType"] })}>
            <option value="openai_compatible">OpenAI compatible</option>
            <option value="custom_openai">Custom OpenAI compatible</option>
            <option value="anthropic_compatible">Anthropic compatible (saved only)</option>
            <option value="local_runtime">Local runtime</option>
          </select>
          <label>Endpoint</label>
          <input type="text" value={activeProfile.endpoint} onChange={(e) => updateProvider({ endpoint: e.target.value })} />
          <label>Organization</label>
          <input type="text" value={activeProfile.organization} onChange={(e) => updateProvider({ organization: e.target.value })} />
          <label>Project</label>
          <input type="text" value={activeProfile.project} onChange={(e) => updateProvider({ project: e.target.value })} />
          <label>
            <input type="checkbox" checked={activeProfile.enabled} onChange={(e) => updateProvider({ enabled: e.target.checked })} />
            Enabled
          </label>
          <CredentialEditor onSave={handleSaveCredential} onDelete={handleDeleteCredential} />
        </div>
      ) : null}

      <h4>Role → Provider + Model Mapping</h4>
      {roleOrder.map((role) => (
        <div key={role}>
          <label>{role}</label>
          <select
            value={settings.roleModelSelections[role]?.profileId ?? ""}
            onChange={(e) =>
              onChange({
                ...settings,
                roleModelSelections: {
                  ...settings.roleModelSelections,
                  [role]: { ...settings.roleModelSelections[role], profileId: e.target.value }
                }
              })
            }
          >
            {settings.providerProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.displayName}</option>
            ))}
          </select>
          <input
            type="text"
            value={settings.roleModelSelections[role]?.model ?? ""}
            onChange={(e) =>
              onChange({
                ...settings,
                roleModelSelections: {
                  ...settings.roleModelSelections,
                  [role]: { ...settings.roleModelSelections[role], model: e.target.value }
                },
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
      <textarea rows={4} value={settings.validationCommands.join("\n")} onChange={(e) => onChange({ ...settings, validationCommands: e.target.value.split("\n").filter(Boolean) })} />
      <label>
        <input type="checkbox" checked={settings.approvalRequiredForApply} onChange={(e) => onChange({ ...settings, approvalRequiredForApply: e.target.checked })} />
        Require explicit approval before apply
      </label>
      <button onClick={onSave}>Save Settings</button>

      <h4>Runtime Diagnostics</h4>
      <button onClick={onRefreshDiagnostics}>Refresh Diagnostics</button>
      {runtimeDiagnostics ? <pre>{JSON.stringify(runtimeDiagnostics, null, 2)}</pre> : <p className="helper">Diagnostics not loaded yet.</p>}
    </section>
  );
}

function CredentialEditor({ onSave, onDelete }: { onSave: (secret: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [secret, setSecret] = useState("");
  return (
    <div>
      <label>API Key / Token</label>
      <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
      <button onClick={() => onSave(secret)}>Save Credential</button>
      <button onClick={onDelete}>Delete Credential</button>
    </div>
  );
}
