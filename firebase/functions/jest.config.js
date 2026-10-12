// functions/jest.config.js
//
// Tests for the Cloud Functions and for `firestore.rules.prod`. Both run
// against the Firestore and Auth EMULATORS -- start them first, with
// `.\scripts\start-dev.ps1 -Action start` from the repo root. Or let
// `npm --prefix firebase run test:functions` start and stop them around the
// run, with the repo's pinned CLI.
//
// Every suite works under its own `demo-` project id. The emulator keeps each
// project's data apart, and a `demo-` id can never name a real project, so
// these suites cannot touch the dev data the app is using.
//
// Not part of the root `npm test`. CI runs it as the `functions` job in
// .github/workflows/test.yml, through `npm --prefix firebase run test:functions`.

/**
 * Packages jest must transpile to CommonJS (T116). `firebase-admin` 14 brings
 * dependencies that ship only ES modules -- `jose`, under `jwks-rsa`, and
 * `node-fetch` 3 with its own -- and two that load `node-fetch` with a dynamic
 * `import()`, which jest's CommonJS runtime refuses without
 * `--experimental-vm-modules`. Node loads all of them as they are; only jest
 * needs this, so production runs the very files the tests do, untranspiled.
 */
const ESM_PACKAGES = [
  "jose",
  "node-fetch",
  "fetch-blob",
  "data-uri-to-buffer",
  "formdata-polyfill",
  "gaxios",
  "teeny-request",
];

module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      tsconfig: {
        module: "commonjs",
        moduleResolution: "node",
        esModuleInterop: true,
        strict: true,
        target: "es2020",
        types: ["jest", "node"],
      },
    }],
    "^.+\.js$": ["ts-jest", {
      tsconfig: {
        allowJs: true,
        isolatedModules: true,
        module: "commonjs",
        esModuleInterop: true,
        target: "es2022",
      },
    }],
  },
  // Transpile those packages wherever npm nested them, and nothing else under
  // node_modules: the path is skipped unless its last `node_modules/` segment
  // is followed by one of them.
  transformIgnorePatterns: [
    `/node_modules/(?!(?:.*/node_modules/)?(?:${ESM_PACKAGES.join("|")})/)`,
  ],
  globalSetup: "<rootDir>/test/globalSetup.ts",
  // One emulator, shared: run the suites one after another.
  maxWorkers: 1,
  testTimeout: 30000,
};
