# FarSend — Principal Software Architect Review

**Reviewer role:** Principal Software Architect
**Scope:** Full client-side codebase — `main.js`, `index.html`, `splash.html`, `public/chains.json`, `vite.config.js`, `vercel.json`, `package.json`, `BatchSender.sol`, `README.md`.
**Branch:** `arena/01a019cb-farsend`
**Date:** 2026-08-20

This is a structural/architectural review (not a re-run of the security audit — see `AUDIT.md` for that). It focuses on **layering, maintainability, data consistency, testability, resilience, and operational correctness.**

---

## 1. Executive summary

FarSend is a **single-page static dApp**: no backend, no build-time config, all business logic lives in one ~1,500-line module (`main.js`) inside a single closure (`initializeApp()`), with `index.html` rendering the UI and `public/chains.json` holding per-chain contract config. The core *money path* is sound (BigInt math, exact-amount approval, all-or-nothing stateless contract). The architectural risks are **not** in the fund-moving logic — they are in **how the app is structured, how config is sourced, and how state/async flows are managed.**

**Top structural risks, in priority order:**

| # | Risk | Severity | Type |
|---|------|----------|------|
| 1 | Monolithic module — no layering, no testability | High | Maintainability |
| 2 | Chain config has **two sources of truth** (AppKit networks + `chains.json`) that can drift | High | Correctness/Data |
| 3 | Duplicate `redirects` key in `vercel.json` silently drops config | High | Operational (FIXED) |
| 4 | Runtime-served config trusted without integrity pinning | Medium | Security/Data |
| 5 | Async state races (approval checks fire on every keystroke) | Medium | Resilience |
| 6 | No automated tests or CI for a money-moving app | High | Quality |

---

## 2. Architecture review by concern

### 2.1 Layering & modularity — ❌ (High)
- **Problem:** `main.js` interleaves five concerns in one closure: (1) config fetch/validation, (2) web3/provider wiring, (3) input parsing/validation, (4) distribution math, (5) DOM/UI rendering + event handling. Everything shares one mutable `state` object and a dozen sibling closures.
- **Impact:** Any change risks the money path; nothing is unit-testable in isolation; onboarding a second dev is slow; dead code is hard to remove.
- **Recommended target structure (Vite native, no framework needed):**
  ```
  src/
    config.js          # chains + ABI + constants (single source of truth)
    web3/chain.js      # provider/signer/chain-switch primitives
    core/parse.js      # pure: parse CSV/text/JSON -> normalized recipients
    core/validate.js   # pure: address/burn/decimals/batch-cap checks
    core/distribute.js # pure: fixed & random distribution math
    core/dispatch.js   # money-path orchestration (BigInt amounts)
    ui/notify.js       # notification/toast
    ui/stepper.js      # step indicator
    ui/render.js       # DOM updates (summary, preview, warnings)
    app.js             # composition root
  ```
  The pure functions (`parse`, `validate`, `distribute`) have **no DOM or ethers dependency** and are the first things to extract and unit-test.

### 2.2 Single source of truth for chains — ❌ (High)
- **Problem:** Chain membership is defined **twice**:
  1. `main.js` imports `[base, mainnet, optimism, arbitrum, bsc, avalanche, polygon]` + a hand-rolled `litvmLiteForge` from `@reown/appkit/networks`.
  2. `public/chains.json` lists chains with RPC/explorer/contract addresses.
- **Impact:** Adding a chain means editing **two places**; if they drift (e.g., a chain in `chains.json` but not in AppKit's network list), wallet connection for that chain silently fails or behaves inconsistently. This is exactly the kind of dual-source bug that ships to production.
- **Recommendation:** Derive AppKit networks from the same config, or validate at build time that the AppKit network set and `chains.json` keys are identical. A tiny script (`scripts/check-chains.mjs`) in CI catches drift.

### 2.3 Runtime config integrity — ⚠️ (Medium)
- **Problem:** The allowance *spender* and the ETH *destination* both come from whatever `chains.json` is served. There is no allowlist/canary.
- **Trade-off acknowledged:** the deliberate design (add chains without redeploying) is convenient, but the served config is a single point of trust.
- **Recommendation (defense-in-depth):** hardcode the canonical Base address as a compiled-in canary and cross-check the fetched config against it on boot; reject the config if it doesn't match. This keeps the "add chain without redeploy" workflow while removing the silent-supply-chain risk.

### 2.4 Async state management — ⚠️ (Medium)
- **Problem:** `updateSummary()` is `async` and calls `checkAndPromptApproval()` (a live RPC `allowance()` call) on **every** input event and chain change. Fast typing produces interleaved in-flight promises that can leave `dispatchBtn` in a stale state.
- **Recommendation:** (a) debounce input; (b) use a monotonically increasing **generation token** so only the latest async result is applied; (c) separate "derive enabled/disabled from sync state" from "re-fetch allowance" so the button never flickers while an RPC is in flight.

### 2.5 Resilience / failure handling — ⚠️ (Medium)
- **Inconsistencies:** some functions return booleans (`validateERC20Address`), some throw (`handleDispatch`), some return early. No central error boundary.
- **Single RPC URL per chain** — no fallback if a provider is down.
- **Recommendation:** standardize on throwing domain errors and catching in one place; add a light provider fallback list per chain.

### 2.6 Operational config — ✅ (one bug FIXED)
- `vercel.json` previously had a **duplicate `redirects` key**, so the Farcaster manifest redirect was silently discarded. **Fixed** — both redirects now live in a single array.
- Remaining: the `/.well-known/farcaster.json` **static file** and the **redirect** to the hosted manifest both exist; verify which is authoritative in production.
- Remaining: `farcaster.json` declares `webhookUrl: /api/webhook` but no `/api` endpoint exists in this static deploy — dead config to remove or implement.

### 2.7 Bundle & performance — ⚠️ (Medium)
- Build warns: `reown` chunk is ~1.3 MB raw / ~400 KB gzip. This is a heavy dependency for a mini-app. Consider dynamic `import()` on first user gesture and review AppKit's tree-shaking.
- 1.5s chain-check polling remains (safety net); acceptable but keep an eye on it.

### 2.8 Accessibility — ⚠️ (Low→Medium)
- Emoji-as-icons replaced with proper inline **SVG** icons (`aria-hidden` + `focusable="false"` on decorative ones); notifications are now a live region (`role="status"` + `aria-live="polite"`). Good progress.
- Remaining: run a Lighthouse/AXE pass; ensure color-only status cues have a text fallback (they do via notification text).

### 2.9 Testing & CI — ❌ (High)
- **No tests at all** for a tool whose sole purpose is moving money. The pure logic (parsing, validation, distribution, burn detection) is easily testable.
- **Recommendation:** add Vitest unit tests for `parse/validate/distribute`; add a GitHub Action that runs `npm ci`, `npm run build`, `node --check`, and the tests on every PR.

---

## 3. What's good (preserve these)

- **BigInt end-to-end on the money path** — amounts go through `ethers.parseUnits` + `BigInt`; no float precision reaches the chain.
- **Exact-amount approval** — the contract spender allowance equals the required total, minimizing exposure.
- **All-or-nothing contract** — `BatchSender.sol` is immutable/stateless; any single recipient failure reverts the whole tx, so the sender never loses funds. No owner/withdraw/upgrade.
- **Pre-flight safety checks** — balance + allowance checks before dispatch, gas estimation with buffer, batch cap, and the burn/dead-address confirmation gate.
- **Clear UX stepper** (Connect → Define → Dispatch) and defensive reset on disconnect/account/chain change.

---

## 4. Prioritized action plan

**P0 (correctness/ops):**
1. ✅ Fix `vercel.json` duplicate `redirects` key (done).
2. ✅ Add build/CI-time chain-config drift guard — `scripts/check-chains.mjs` verifies `chains.json` shape, addresses, unique IDs, and that the chain set matches the AppKit networks imported in `main.js` (single-source-of-truth guard). Runs in CI and via `npm run check:chains`.

**P1 (structure/quality):**
3. ✅ Extract pure functions into modules + Vitest tests (done):
   - `src/core/parse.js` — `parseRecipients`, `validateRecipients`, `splitLine`
   - `src/core/validate.js` — `isBurnAddress`, `findBurnRecipients`, `burnTotal`, `DEFAULT_BURN_ADDRESSES`
   - `src/core/distribute.js` — `extractAddresses`, `applyFixedAmount`, `generateRandomDistribution`
   - `test/{parse,validate,distribute}.test.js` — **28 passing tests**
4. ✅ Add CI — `.github/workflows/ci.yml`: `npm ci` → `node --check` → `check:chains` → `npm test` → `npm run build`. (`package-lock.json` is now committed so `npm ci` is reproducible.)
5. ⏳ Compiled-in contract-address canary / config integrity check — still open (the drift guard partially covers this; a boot-time canary that rejects a mismatched served config remains).

**P2 (resilience/UX):**
6. Debounce + generation-token the async summary/allowance path.
7. Standardize error handling; add provider fallback.
8. Lazy-load the Reown chunk; review bundle size.
9. Remove or implement the dead `webhookUrl`; reconcile manifest static-file vs redirect.

---

## 5. Bottom line

The **money path is trustworthy** — the contract is stateless and all-or-nothing, and the frontend does BigInt math with pre-flight checks. The **engineering structure is not yet production-grade**: it's a single monolithic module with dual chain-config sources, no tests, and no CI. None of this is a *fund-loss* risk today (that was the audit's finding, now largely addressed), but it will become a *correctness and maintenance* risk as chains and features grow. The highest-leverage work is: **one source of truth for chain config, extract-and-test the pure logic, and add CI.**
