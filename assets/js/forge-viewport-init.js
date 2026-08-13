"use strict";
// Kept as its own tiny external module (instead of an inline <script type="module">)
// because the server's CSP is script-src 'self' with no 'unsafe-inline' — inline
// script blocks get blocked by the browser regardless of what's inside them.
import { initForgeViewport } from './forge-viewport.js';
initForgeViewport();
