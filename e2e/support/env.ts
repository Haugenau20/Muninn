// e2e/support/env.ts

/**
 * Where the journeys find everything: the emulators firebase/firebase.e2e.json
 * starts (keep the ports in step with it) and the production build served by
 * `vite preview`.
 *
 * The project id starts with `demo-`, which keeps the emulators and the Admin
 * SDK from reaching any real Firebase project.
 */
export const E2E = {
  projectId: "demo-e2e",
  host: "127.0.0.1",
  authPort: 19099,
  firestorePort: 18080,
  functionsPort: 15001,
  appPort: 4300,
  /** The operator page's dev server (T137), not the dev one's 4700. */
  operatorPort: 4701,
  get appUrl(): string {
    return `http://${this.host}:${this.appPort}`;
  },
  get operatorUrl(): string {
    return `http://${this.host}:${this.operatorPort}`;
  },
  get authUrl(): string {
    return `http://${this.host}:${this.authPort}`;
  },
  get firestoreUrl(): string {
    return `http://${this.host}:${this.firestorePort}`;
  },
} as const;

/**
 * The environment the app is built with. `vite.config.ts` lets these win over
 * any .env file, so a developer's own `.env` cannot point the build at
 * production. The API key is a placeholder: the emulators accept any.
 */
export const appBuildEnv: Record<string, string> = {
  REACT_APP_USE_EMULATORS: "true",
  REACT_APP_EMULATOR_HOST: E2E.host,
  REACT_APP_AUTH_EMULATOR_PORT: String(E2E.authPort),
  REACT_APP_FIRESTORE_EMULATOR_PORT: String(E2E.firestorePort),
  REACT_APP_FUNCTIONS_EMULATOR_PORT: String(E2E.functionsPort),
  // Not started (see firebase.e2e.json), and not the development emulators'
  // 9199 either: a call there fails at once instead of reaching them.
  REACT_APP_STORAGE_EMULATOR_PORT: "19199",
  REACT_APP_PROJECT_ID: E2E.projectId,
  REACT_APP_API_KEY: "fake-api-key",
  REACT_APP_AUTH_DOMAIN: `${E2E.projectId}.firebaseapp.com`,
  REACT_APP_STORAGE_BUCKET: `${E2E.projectId}.appspot.com`,
};

/** The file the signed-in browser state is saved to and read from. */
export const SIGNED_IN_STATE = "test-results/.auth/player.json";
