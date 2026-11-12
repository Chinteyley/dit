import { useEffect, useRef } from 'react';

/** Two triggers (focus and visibilitychange) arrive together when the partner comes back. */
const MIN_RETRY_GAP_MS = 1_000;

/**
 * After a microphone or camera permission failure, retries once access looks allowed again,
 * so the partner never has to reload the page:
 * - when the site permission changes to granted (allowed from the address bar or site settings);
 * - when the page regains focus while the site permission is granted (the browser itself was
 *   blocked by the operating system and has just been allowed in System Settings).
 * Does nothing while the permission is still denied or not yet asked, so it never re-prompts.
 */
export function useRetryWhenAllowed(active: boolean, device: 'microphone' | 'camera', retry: () => void): void {
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let cancelled = false;
    let lastRetry = -Infinity;
    let status: PermissionStatus | null = null;
    const fire = (): void => {
      const now = performance.now();
      if (cancelled || now - lastRetry < MIN_RETRY_GAP_MS) return;
      lastRetry = now;
      retryRef.current();
    };
    const state = async (): Promise<PermissionState | null> => {
      try {
        return (await navigator.permissions?.query({ name: device as PermissionName }))?.state ?? null;
      } catch {
        return null;
      }
    };
    const onReturn = (): void => {
      if (document.visibilityState !== 'visible') return;
      // Without a permission query (unsupported name), a return is still worth one retry.
      void state().then((s) => { if (s === 'granted' || s === null) fire(); });
    };
    const onChange = (): void => {
      if (status?.state === 'granted') fire();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    void (async () => {
      try {
        const result = await navigator.permissions?.query({ name: device as PermissionName });
        if (cancelled || !result) return;
        status = result;
        status.addEventListener('change', onChange);
      } catch {
        // Focus retries still cover browsers without this permission name.
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      status?.removeEventListener('change', onChange);
    };
  }, [active, device]);
}
