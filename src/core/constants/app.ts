// src/core/constants/app.ts

/**
 * The running app version, attached to contact submissions so a bug report
 * says which build it came from without the reporter having to know.
 *
 * Create React App only exposes environment variables prefixed
 * `REACT_APP_`, and nothing sets one today, so the fallback is what a local
 * dev build reports. Set `REACT_APP_VERSION` in the deploy environment to
 * make this meaningful in production.
 */
export const APP_VERSION = process.env.REACT_APP_VERSION || "0.1.0-dev";
