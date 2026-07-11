# Future Architecture Goals (July 2026 SOTA)

The following architectural objectives define the absolute pinnacle of what the Rover Automation engine can achieve as an uncompromising, universally portable script maker and form flow recorder.

### 1. Abstract Semantic Abstraction (The "Write Once, Run Anywhere" Engine)
Instead of rigidly mapping exact CSS/DOM paths, the recorder leverages on-device semantic models to tag the fundamental *purpose* of every interacted field in real-time. 
* **Mechanism:** When a user records a checkout flow, the engine logs the semantic intent (e.g., `[INTENT: INITIATE_CHECKOUT]`) rather than just `[id="nav-cart"]`. The resulting script becomes a universally portable blueprint that can be injected into entirely different website architectures, with the engine automatically translating recorded intents to the new site's unique DOM.

### 2. Zero-Overhead Network-Aware Dependency Injection
Current recorders operate blindly on the DOM layer without visibility into the underlying data layer, often failing because they click buttons before necessary data loads.
* **Mechanism:** The recorder passively taps into the underlying network layer during recording. If an XHR or GraphQL request fires immediately following a user interaction, the recorder automatically detects the network round-trip and dynamically injects `network-idle` or `await-fetch` dependency barriers directly into the `.ras.json` script. This mathematically guarantees the script will never outpace the server during future executions.

### 3. Multi-Dimensional Cross-Origin Tracking (The Auth-Bridger)
Modern authentication flows (OAuth popups, banking 3D-secure redirects, email 2FA tabs) routinely break standard linear recorders that are locked to a single origin context.
* **Mechanism:** The recording state engine expands into a multi-tab IPC (Inter-Process Communication) mesh coordinated via the Background Service Worker. When the user flow jumps into a secondary window or popup, the recorder seamlessly bridges the origin gap, stitching the multi-tab, multi-origin journey into one chronologically unbroken, cohesive script.

### 4. Generative Conditional Branching (Logic-Aware Recording)
Standard recorders only generate fragile, strictly linear scripts. Universal forms, however, are highly dynamic, with interactions spawning cascading structural changes (e.g., ticking a checkbox reveals new sections).
* **Mechanism:** By deeply analyzing the mutation traces captured during recording, the engine correlates specific interactions with massive DOM geometry shifts. It automatically deduces these logical branches and writes conditional `IF/THEN` paths into the `.ras.json` file. The script records not just the user's action, but *why* the form reacted, resulting in a robust, multi-path blueprint.

### 5. Multi-Modal Shadow DOM & Canvas Extraction
Increasingly, enterprise forms are deeply obfuscated inside nested Web Components (closed Shadow DOMs) or rendered entirely on WebGL `<canvas>` elements (e.g., Flutter Web apps), rendering standard DOM recording completely blind.
* **Mechanism:** When obfuscation is detected, the recorder bypasses the standard DOM entirely. It fuses raw Accessibility Tree (CDP) readouts with highly optimized, localized OCR bounding-box extraction. It translates canvas coordinates and closed-shadow interactions into a standardized universal script format, rendering the recorder entirely immune to front-end framework obfuscation.
