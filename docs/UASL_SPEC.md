# Unified Automation Script Language (UASL) Specification

The **Unified Automation Script Language (UASL)** is an advanced, highly-detailed scripting format designed to be the "God Language" of web automation. 

It is designed to bridge the gap between human-readable record-and-replay tools (like Bugbug), programmatic script execution (like SeleniumBase / Playwright), and advanced AI-driven heuristics (like Rover). 

Files use the `.rover.yaml` or `.ras` (Rover Automation Script) extension.

## Why UASL?

Traditional automation scripts rely on fragile, single-point-of-failure locators (e.g., `button#submit`). If the DOM changes, the script breaks. 
UASL introduces the concept of a **Selector Cascade**. If a primary CSS selector fails, the engine gracefully degrades to XPath, then Shadow DOM traversal, then Text Heuristics, then Vision API bounding boxes, and finally absolute screen coordinates.

Furthermore, UASL scripts are fully transpilable. A `.rover.yaml` file can be mathematically converted into a Playwright script, a Bugbug JSON export, or an executable Rover state.

## Core Structure

A UASL script contains four top-level blocks:
1. `version`: The UASL schema version.
2. `metadata`: Contextual information about the automation target.
3. `schema`: The expected input data structure (if the script is a reusable "skill").
4. `steps`: The chronological array of actions to execute.

### Example Skeleton

```yaml
version: "1.0.0"
metadata:
  target_url: "https://example.com"
  description: "Fills out the main form with AI fallbacks."
  dependencies:
    - plugin: "vision-ai"
    - plugin: "shadow-dom-piercer"

schema:
  - field: "email"
    type: "string"
    description: "User's email address"

steps:
  # ... actions go here
```

## The Selector Cascade

The core innovation of UASL is the `selectors` block. Every interactive step uses a cascade. The automation engine evaluates these in order of strictness.

```yaml
selectors:
  primary: "input[name='email']"                   # 1. Fast, strict CSS lookup
  xpath: "//input[@type='email']"                  # 2. Structural fallback
  shadow_dom_path: ["custom-login-form", "input"]  # 3. Pierces Web Components
  heuristic: "Email Address"                       # 4. Text-based fuzzy matching
  vision_fallback: "Input field below the 'Welcome' text" # 5. Multimodal AI fallback
  coordinates: { x: 450, y: 600 }                  # 6. Absolute blind click (Bugbug style)
```

## Action Steps

The `steps` array defines the chronological execution of the script.

### 1. `navigate`
Navigates the browser to a specific URL.
```yaml
- action: "navigate"
  url: "https://example.com/login"
```

### 2. `fill_field`
Fills an input, textarea, or selects a dropdown value.
```yaml
- action: "fill_field"
  selectors:
    primary: "#user_email"
    heuristic: "Email"
  data_source: "$schema.email" # Binds to the top-level schema
  wait_for_stability: 500      # Wait 500ms after typing
```

### 3. `click`
Executes a mouse click on an element.
```yaml
- action: "click"
  selectors:
    primary: "button.submit"
    heuristic: "Log In"
```

### 4. `extract`
Extracts data from the page to be returned by the script.
```yaml
- action: "extract"
  selectors:
    primary: ".balance-amount"
    heuristic: "Total Balance"
  export_as: "account_balance"
```

### 5. `wait`
A hard or conditional wait.
```yaml
- action: "wait"
  condition: "element_visible"
  selectors:
    primary: ".dashboard-header"
  timeout_ms: 10000
```

## Transpilation

UASL is designed to be transpiled.
- **To Playwright:** Generates a `.spec.ts` file using `page.locator()` with chained `try/catch` blocks reflecting the Selector Cascade.
- **To Bugbug:** Maps the `coordinates` and `primary` selectors to Bugbug's internal step JSON.
- **To Rover:** Direct execution via `src/form-recorder/replay-engine.js`, utilizing Rover's native Shadow DOM and Vision API integrations.
