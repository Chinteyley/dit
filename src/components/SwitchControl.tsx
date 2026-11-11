export interface SwitchControlProps {
  /** The visible label, which is also the accessible name. */
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  /** Id of an element that describes the switch, for example a message about its state. */
  readonly describedBy?: string | undefined;
}

/**
 * An on/off switch: a native button with role="switch" and aria-checked, used by the Listen,
 * flip and adaptation controls. The knob moves to the right and the track fills with the accent
 * when on, so the state never relies on colour alone; the knob turns dark on the accent fill to
 * keep 3:1. A disabled switch keeps its label at full contrast (Req 22.2).
 */
export function SwitchControl({ label, checked, onChange, disabled = false, describedBy }: SwitchControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-(--size-target) w-full items-center justify-between gap-4 rounded-xl border border-border bg-raised px-4 py-2 text-left text-lg font-medium text-text disabled:cursor-not-allowed disabled:text-muted"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 ${
          checked ? 'border-accent bg-accent' : 'border-border bg-surface'
        }`}
      >
        <span
          className={`absolute left-0.5 size-5 rounded-full motion-safe:transition-transform motion-safe:duration-(--duration-fade) ${
            checked ? 'translate-x-5 bg-on-accent' : 'translate-x-0 bg-text'
          }`}
        />
      </span>
    </button>
  );
}
