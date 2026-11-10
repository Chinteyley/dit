import { useContext, useId } from 'react';
import type { StatusMessage } from '@/hooks/session-controller';
import { SessionApiContext } from './session-api-context';

export interface StatusMessagesProps {
  /** One per id, in the order they appeared. */
  readonly messages: readonly StatusMessage[];
  readonly onDismiss: (id: StatusMessage['id']) => void;
}

/**
 * Status messages (Requirements 16.9, 17.3, 17.4, 17.6, 22.12, 22.13): save failures, missing
 * voices, speech errors and input source problems, each with a "Dismiss" button. It sits right
 * after the h1, so screen reader users meet it first, and it is deliberately not a live region,
 * so the page keeps exactly one (Req 12.8). Dismissing returns focus to the Keying_Surface.
 */
export function StatusMessages({ messages, onDismiss }: StatusMessagesProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const baseId = useId();
  if (messages.length === 0) return null;

  return (
    <ul aria-label="Status" className="flex flex-col gap-3">
      {messages.map((message) => {
        const textId = `${baseId}-${message.id}`;
        return (
          <li
            key={message.id}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border-l-4 border-error bg-surface py-3 pr-3 pl-5"
          >
            <p id={textId} className="min-w-0 flex-1 text-lg text-text">
              {message.text}
            </p>
            <button
              type="button"
              aria-describedby={textId}
              onClick={() => {
                onDismiss(message.id);
                focusKeyingSurface();
              }}
              className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-4 text-base font-medium text-text"
            >
              Dismiss
            </button>
          </li>
        );
      })}
    </ul>
  );
}
