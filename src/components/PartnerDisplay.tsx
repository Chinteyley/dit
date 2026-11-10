import { useId } from 'react';

export interface PartnerDisplayProps {
  readonly currentText: string;
  readonly lastSpoken: string | null;
  /** Rotate the content 180° for a partner across the bed. */
  readonly flip: boolean;
}

/**
 * The Partner_Display (Requirement 14): Current_Text and Last_Spoken in very large near-white
 * type, under the visible labels "Typing" and "Last said". Text wraps, so 500 characters stay
 * readable at 320 px. Flip rotates the inner wrapper with a CSS transform and keeps the DOM order;
 * the content fades in over 150 ms after a flip, and switches in a single step under reduced
 * motion.
 */
export function PartnerDisplay({ currentText, lastSpoken, flip }: PartnerDisplayProps) {
  const typingId = useId();
  const lastId = useId();

  return (
    <div
      // A new key remounts the wrapper on flip, so the fade runs once per change.
      key={flip ? 'flipped' : 'upright'}
      role="group"
      aria-label="Partner display"
      style={flip ? { transform: 'rotate(180deg)' } : undefined}
      className="flex flex-col gap-5 motion-safe:animate-fade-in"
    >
      <section aria-labelledby={typingId} className="flex flex-col gap-3">
        <h2 id={typingId} className="section-label">
          Typing
        </h2>
        <p className="text-display font-medium tracking-tight whitespace-pre-wrap text-text wrap-anywhere">
          {currentText === '' ? <span className="text-muted">Nothing typed yet</span> : currentText}
        </p>
      </section>
      <section aria-labelledby={lastId} className="flex flex-col gap-2">
        <h2 id={lastId} className="section-label">
          Last said
        </h2>
        <p className="text-last whitespace-pre-wrap text-text wrap-anywhere">
          {lastSpoken === null ? <span className="text-muted">Nothing said yet</span> : lastSpoken}
        </p>
      </section>
    </div>
  );
}
