// Quantum Wallet v2 — entry point. All logic lives in src/ui/app.mjs
// (UI) and src/app/session.mjs (session controller); the cryptographic
// core is in src/core/.
import { startApp } from './src/ui/app.mjs';

startApp();
