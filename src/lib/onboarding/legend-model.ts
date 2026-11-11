/**
 * The Legend_Model (design "lib/onboarding/legend-model.ts", Requirement 8): the 4 command
 * entries, built at run time from the Command_Table so no code is ever copied here.
 */
import { COMMAND_TABLE, type CommandName } from '@/lib/morse';
import { spokenCode } from './spoken';
import { COMMAND_LABELS } from './strings';

export { COMMAND_LABELS, COMMAND_SENTENCES } from './strings';

/** Display order of the commands (Requirement 8.1). */
export const COMMAND_ORDER: readonly CommandName[] = Object.freeze(['speak', 'next', 'backspace', 'sos']);

export interface LegendEntry {
  readonly command: CommandName;
  readonly code: string;
  readonly label: string;
}

/** Inverts the Command_Table (code → name), then orders the entries by COMMAND_ORDER. */
export function buildLegendModel(table: Readonly<Record<string, CommandName>> = COMMAND_TABLE): readonly LegendEntry[] {
  const codeOf = new Map<CommandName, string>();
  for (const [code, command] of Object.entries(table)) {
    if (!codeOf.has(command)) codeOf.set(command, code);
  }
  const entries: LegendEntry[] = [];
  for (const command of COMMAND_ORDER) {
    const code = codeOf.get(command);
    if (code !== undefined) entries.push(Object.freeze({ command, code, label: COMMAND_LABELS[command] }));
  }
  return Object.freeze(entries);
}

/** "Speak: dot dash dot dash dot" (Requirement 8.4). */
export function legendAccessibleText(e: LegendEntry): string {
  return `${e.label}: ${spokenCode(e.code)}`;
}
