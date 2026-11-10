// Public API of the speech wrappers. browser.ts (Web Speech adapters) is imported from its own
// file by the session hook, and fakes.ts stays private to tests.
export { LISTEN_MESSAGE_TEXT, initialListen, listenStep } from './listen';
export type { ListenCommand, ListenInput, ListenMessage, ListenState, ListenStep } from './listen';
export type { RecognitionError, SpeechInput, SpeechOutput, UtteranceOutcome, VoiceInfo } from './types';
