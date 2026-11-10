import { DitRoot } from '@/components/DitRoot';

// A server component: DitRoot is the client boundary that builds the alarm, the Press_Router,
// onboarding and the Cheat_Sheet once and hands them to DitApp.
export default function Page() {
  return <DitRoot />;
}
