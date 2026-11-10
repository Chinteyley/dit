import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // No Next.js dev badge on screen (it shows up in demo recordings); compile and runtime errors
  // still show in development.
  devIndicators: false,
  async headers() {
    return [
      {
        // Page scripts may only connect to this origin. connect-src covers fetch, XHR, WebSocket
        // and beacons, so the browser itself blocks any third-party request, such as the usage
        // telemetry built into @mediapipe/tasks-vision 1.2.2 (also switched off in
        // src/lib/input/blink/browser.ts). Scripts, styles, fonts and images are not restricted,
        // and same-origin dev HMR websockets stay allowed.
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "connect-src 'self'" }],
      },
      {
        // The self-hosted MediaPipe files live in a versioned folder and never change in place.
        source: '/mediapipe/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
