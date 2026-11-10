import { DitApp } from '@/components/DitApp';

// The onboarding-and-safety plug-ins (alarm, unknownPattern, legend, overlay) are passed here once
// that spec exists; until then DitApp uses its inert stand-ins and an empty legend box.
export default function Page() {
  return <DitApp />;
}
