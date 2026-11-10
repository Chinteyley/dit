import { useContext, useId, useRef, useState } from 'react';
import { TEXT_MAX } from '@/lib/conversation';
import { trimWhitespace } from '@/lib/expansion';
import { SessionApiContext } from './session-api-context';

export interface PartnerLineFormProps {
  /** Receives the trimmed, non-empty line; returns true when it was added. */
  readonly onSubmit: (text: string) => boolean;
}

/**
 * The Partner_Line_Form (Requirement 19): the partner types a line for the conversation context.
 * Space and Enter type normally here (the input layer leaves editable fields alone). A line that
 * is empty after trimming changes nothing and keeps focus in the field; an added line clears the
 * field and returns focus to the Keying_Surface (Req 21.2, 21.3).
 */
export function PartnerLineForm({ onSubmit }: PartnerLineFormProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  return (
    <form
      className="flex w-full max-w-[min(100%,28rem)] flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const line = trimWhitespace(value);
        if (line === '' || !onSubmit(line)) {
          inputRef.current?.focus();
          return;
        }
        setValue('');
        focusKeyingSurface();
      }}
    >
      <label htmlFor={inputId} className="text-lg font-medium text-text">
        Your line
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="off"
          maxLength={TEXT_MAX}
          value={value}
          // maxLength already limits typing and paste; the slice covers browsers that let more through (Req 19.8).
          onChange={(event) => setValue(event.target.value.slice(0, TEXT_MAX))}
          className="min-h-(--size-target) min-w-0 flex-1 rounded-xl border border-border bg-raised px-4 text-lg text-text placeholder:text-muted"
        />
        <button
          type="submit"
          className="min-h-(--size-target) shrink-0 rounded-xl border border-border bg-raised px-4 text-lg font-medium text-text"
        >
          Add line
        </button>
      </div>
    </form>
  );
}
