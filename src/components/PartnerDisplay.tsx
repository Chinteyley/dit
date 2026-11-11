import { useId } from 'react';

export interface PartnerDisplayProps {
  readonly currentText: string;
  readonly lastSpoken: string | null;
  /** Rotate the content 180° for a partner across the bed. */
  readonly flip: boolean;
}

/**
 * The Partner_Display (Requirement 14), drawn on the Composer_Panel: Last_Spoken under the label
 * "Last said", then Current_Text under "Typing" in the largest near-white type, so the Stream_Band
 * that follows sits directly under the sentence being formed (Req 24.6). The group takes the
 * panel's spare height between its two sections, so "Last said" holds the top of the panel and
 * the sentence being formed sits on the tape at the bottom, and a second line of Current_Text
 * grows upward into the spare height. Each area keeps one line of its text size, and the
 * placeholders are small and muted directly under their labels, so an idle screen is calm and the
 * first character or sentence moves nothing (Req 14.8, 14.9, 24.8). A placeholder line is
 * leading-snug (1.375 x 20 px = 27.5 px), never taller than one line of the text it stands in for
 * (at least 28.8 px), so the area is exactly one line of that text with or without it. Text wraps,
 * so 500 characters stay readable at 320 px. Flip rotates the group with a CSS transform and keeps
 * the DOM order; the content fades in over 150 ms after a flip, and switches in a single step under
 * reduced motion.
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
      className="flex flex-1 flex-col justify-between gap-3 md:gap-4 wide:short:gap-3 motion-safe:animate-fade-in"
    >
      <section aria-labelledby={lastId} className="flex flex-col gap-1">
        <h2 id={lastId} className="section-label">
          Last said
        </h2>
        {/* One text-last line high even with the small placeholder, a block at the top of the line whose
            leading-snug line (27.5 px) is never taller than one text-last line (28.8 px on phones). */}
        <p className="min-h-[1lh] text-last whitespace-pre-wrap text-text wrap-anywhere">
          {lastSpoken === null ? <span className="block text-lg leading-snug text-muted">Nothing said yet</span> : lastSpoken}
        </p>
      </section>
      <section aria-labelledby={typingId} className="flex flex-col gap-1.5">
        <h2 id={typingId} className="section-label">
          Typing
        </h2>
        <p className="min-h-[1lh] text-display font-medium tracking-tight whitespace-pre-wrap text-text wrap-anywhere">
          {currentText === '' ? (
            <span className="block text-lg leading-snug font-normal tracking-normal text-muted">Nothing typed yet</span>
          ) : (
            currentText
          )}
        </p>
      </section>
    </div>
  );
}
