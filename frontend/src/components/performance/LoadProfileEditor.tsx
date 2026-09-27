import { useEffect, useState } from "react";
import type { LoadProfile, LoadProfileKind, LoadStage } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { formatDuration, secondsToMs } from "./performanceViewModel";

/**
 * The load profile's stages (FR-017, FR-019). The starting stages come from the server; the user
 * edits them as numbers. No maximum and no warning is applied. Changes are sent on Save, so a
 * half-typed number never reaches the plan.
 */
const KINDS: LoadProfileKind[] = ["smoke", "load", "stress", "spike", "soak"];
const INPUT = "w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

interface DraftStage {
  seconds: string;
  target: string;
}

function toDraft(stages: LoadStage[]): DraftStage[] {
  return stages.map((stage) => ({ seconds: String(stage.durationMs / 1000), target: String(stage.targetVirtualUsers) }));
}

export function LoadProfileEditor({
  profile,
  startingStages,
  busy,
  onSave,
}: Readonly<{
  profile: LoadProfile;
  startingStages: (kind: LoadProfileKind) => LoadStage[];
  busy: boolean;
  onSave: (profile: { kind: LoadProfileKind; stages: LoadStage[] }) => void;
}>) {
  const [kind, setKind] = useState<LoadProfileKind>(profile.kind);
  const [stages, setStages] = useState<DraftStage[]>(() => toDraft(profile.stages));
  useEffect(() => {
    setKind(profile.kind);
    setStages(toDraft(profile.stages));
  }, [profile]);

  const parsed = stages.map((stage) => ({ seconds: Number(stage.seconds), target: Number(stage.target) }));
  const valid = parsed.length > 0 && parsed.every((stage) => Number.isFinite(stage.seconds) && stage.seconds > 0 && Number.isInteger(stage.target) && stage.target >= 0);
  const plannedMs = valid ? parsed.reduce((total, stage) => total + secondsToMs(stage.seconds), 0) : 0;
  const peak = valid ? Math.max(...parsed.map((stage) => stage.target)) : 0;
  const update = (index: number, patch: Partial<DraftStage>) => setStages((current) => current.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="load-profile-kind" className="text-sm font-medium">
          Profile
        </label>
        <select
          id="load-profile-kind"
          value={kind}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value as LoadProfileKind;
            setKind(next);
            setStages(toDraft(startingStages(next)));
          }}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-chrome text-left text-xs text-muted">
            <th scope="col" className="px-2 py-1.5 font-semibold">Stage</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">Duration (s)</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">Target VUs</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage, index) => (
            <tr key={index} className="border-t border-border">
              <td className="px-2 py-1.5 text-muted">{index + 1}</td>
              <td className="px-2 py-1.5">
                <input aria-label={`Stage ${index + 1} duration in seconds`} type="number" min={1} value={stage.seconds} disabled={busy} onChange={(event) => update(index, { seconds: event.target.value })} className={INPUT} />
              </td>
              <td className="px-2 py-1.5">
                <input aria-label={`Stage ${index + 1} target virtual users`} type="number" min={0} value={stage.target} disabled={busy} onChange={(event) => update(index, { target: event.target.value })} className={INPUT} />
              </td>
              <td className="px-2 py-1.5">
                {stages.length > 1 && (
                  <button type="button" aria-label={`Remove stage ${index + 1}`} disabled={busy} onClick={() => setStages((current) => current.filter((_, i) => i !== index))} className="rounded px-1 text-muted hover:text-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setStages((current) => [...current, { seconds: "60", target: "1" }])}>
          + Add stage
        </button>
        <span>
          Planned duration <strong className="font-mono">{valid ? formatDuration(plannedMs) : "—"}</strong> · peak <strong className="font-mono">{valid ? peak : "—"}</strong> VUs
        </span>
      </div>
      <p className="text-xs text-muted">Starting values only, not recommended targets. No limit is applied; the stages run exactly as entered.</p>
      <button
        type="button"
        className={BUTTON_STYLES.secondary}
        disabled={busy || !valid}
        onClick={() => onSave({ kind, stages: parsed.map((stage) => ({ durationMs: secondsToMs(stage.seconds), targetVirtualUsers: stage.target })) })}
      >
        Save load profile
      </button>
    </div>
  );
}
