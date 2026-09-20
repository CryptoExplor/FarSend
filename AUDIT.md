# FarSend — Audit & Code Review

**Scope:** Full codebase (client-side only)
**Files reviewed:** `main.js`, `index.html`, `splash.html`, `BatchSender.sol`, `public/chains.json`, `public/.well-known/farcaster.json`, `vite.config.js`, `vercel.json`, `package.json`, `README.md`
**Branch:** `arena/01a019cb-farsend`

---

## Status update (latest)

The items marked **✅ FIXED** below were addressed after the initial review. The batch-sender contract source is now published at `BatchSender.sol` and has been reviewed (see the contract section below). A new **burn/dead-address safety option** was added to the UI, and several safety fixes were shipped.

> **This document is actively maintained.** For the complementary **principal-software-architect review** (layering, maintainability, single-source-of-truth, testing/CI, resilience), see **[`ARCHITECTURE.md`](ARCHITECTURE.md)**.

---

## Verdict in one line

FarSend is a clean, well-structured **frontend-only** batch-sender app. The client-side logic is generally sound — amounts are handled with `BigInt` (not floats) at dispatch time, balances and allowances are pre-checked, and approval is exact-amount. The batch-sender contract (`BatchSender.sol`) is now in the repo: it is the standard, well-known **Disperse** pattern — immutable and stateless, with no owner or withdraw path — which is exactly what you want for a fund-moving contract. The remaining main action item is confirming each deployed address is verified on its block explorer.

---

## 🔴 CRITICAL / HIGH

### 1. The smart contract source is now available — ✅ RESOLVED
- `BatchSender.sol` is now in the repo. It is the standard, widely-deployed **Disperse** pattern:
  - `disperseEther` sends ETH via `recipient.call{value: amount}` with a length-mismatch check and a leftover refund.
  - `disperseToken` pulls the exact total via `transferFrom`, then `transfer`s to each recipient, refunding leftovers.
- **Security properties (good):**
  - **Immutable & stateless** — no owner, no upgrade proxy, no withdraw/pause, no storage of funds. The contract can never move money except to the exact recipients the caller specifies.
  - **Length-mismatch checks** and **revert-on-any-failure** (if one recipient rejects, the whole tx reverts — so the sender loses nothing).
  - Refund logic returns any excess `msg.value` / token dust to the sender.
- **Known limitations (not vulnerabilities):**
  - **Fee-on-transfer / rebasing tokens** will break the exact `total` math and revert (standard Disperse limitation). This is a per-token compatibility concern, not a security flaw.
  - Reentrancy is not a fund-loss vector here because the contract holds no state and no balances.
- **Remaining action item (⚠️ please confirm):** verify **each** deployed address in `chains.json` on its block explorer so users can see the exact verified code. The source + ABI are now reproducible, but verification of each specific address is the last provenance step.

### 2. Contract addresses in client-served config — ✅ PARTIALLY MITIGATED (by design)
- `main.js` still fetches `chains.json` at runtime. This was intentionally left as-is so you can add new chains (and deploy new `BatchSender.sol` copies) **without redeploying the frontend or changing code** — you only add an entry to `chains.json`.
- **Compatibility (your question):** the new `BatchSender.sol` uses the exact same function signatures as the ABI already in `chains.json`, so **old and new contracts work together**. You do **not** need to redeploy existing chains — keep the old addresses, and simply deploy the new contract on the new chain and add its address. No code change needed, because the frontend only talks to contracts through that identical ABI.
- Trade-off to be aware of: the served config is a single point of trust. If you later want defense-in-depth, hardcode the Base address as a canary and cross-check the fetched config against it.

---

## 🟠 MEDIUM

### 3. Fallback gas-limit path broadcasts a guaranteed-revert tx — ✅ FIXED
`handleDispatch` now treats `estimateGas` failure as **fatal** (except `ACTION_REJECTED`) and no longer broadcasts a manual-gas fallback that would burn the user's gas on a guaranteed revert.

### 4. `updateSummary()` is async and fires `checkAndPromptApproval()` on every change — ⏳ OPEN
Every keystroke still triggers a live `allowance()` RPC call. This is a remaining performance/UX improvement (debounce + generation token), but not a safety bug.

### 5. Zero-address recipients — ✅ FIXED (now a first-class "burn" flow)
`ethers.getAddress(0x0…)` still succeeds, but sending to a burn/dead address now requires an explicit confirmation (see the new Burn/Dead Address feature below), so funds can't be silently burned.

### 6. No recipient-count / batch-size cap — ✅ FIXED
Added `MAX_RECIPIENTS = 500`. Dispatch is blocked (and the button disabled) above the cap with a clear message to split the batch.

---

## 🟡 LOW / CLEANUP

### 7. Dead / broken / leftover assets
- `public/indexold.html` (~95 KB) is a committed leftover of an older version — remove it.
- `farcaster.json` declares a `webhookUrl` → `https://farsend.vercel.app/api/webhook`, but there is **no `/api` directory or serverless function** in the repo. The webhook points at a 404.
- README references a `LICENSE` file and a `base.json` config that **do not exist** in the repo.

### 8. Revert-decode bug that works by accident — ✅ FIXED
The `data.slice(2 || data)` bug and the two near-identical decode branches were consolidated into a single `decodeRevertReason()` helper that handles top-level and nested `error.error.data`, decodes custom errors and standard `Error("reason")` strings, and no longer has the latent `2 || data` bug.

### 9. Perf: 1.5s polling + console spam — ✅ PARTIALLY FIXED
Removed the per-cycle `"Polling: no chain change detected"` log spam. The 1.5s polling interval itself remains (used as a safety net for chain changes that miss the `chainChanged` event).

### 10. Multiple provider subscriptions — ✅ FIXED
Removed the redundant/empty `subscribeProviders` registration in the initial-load block; the single main subscriber now handles wallet state.

### 11. Secrets/config hygiene
- Reown `projectId` `0c80bc29…` is hardcoded in source. A WalletConnect projectId isn't a secret, but it should live in an env var and the README's `.env` story is aspirational.
- `window.appKit` and `window.confetti` are intentionally global — fine, but worth noting as a small attack surface if the page ever runs untrusted third-party scripts.

### 12. Float math in display paths
`updateSummary` and the random-distribution tool sum amounts with `parseFloat`/`toFixed`. This is **display-only** — actual dispatch uses `BigInt` via `parseUnits`, so sent amounts are exact. But the UI total can differ from the exact wei the user is about to send; show a precise total and let the user confirm the exact amount in the final step.

### 13. `chains.json` is served from `/` but referenced as `/chains.json`
Minor routing note: with `vercel.json` redirecting `/` to `splash.html`, and `vite.config.js` using `publicDir: 'public'`, the config file lands at `/chains.json` in `dist` — confirm the Vercel build copies `public/chains.json` to the root correctly (the manualChunks/two-page build makes this worth a quick smoke test after deploy).

---

## 🆕 New feature: Burn / Dead Address safety option

- When a recipient list contains a **burn or dead address** (`0x0000…0000` or `0x0000…dEaD`), a red warning panel appears in the Review & Dispatch step showing the **count** and **total amount** going to those addresses.
- The **Dispatch** button stays disabled until the user ticks **"I understand these funds will be burned and cannot be recovered."**
- The panel **only appears when such an address is present** — normal batches are unaffected, and the confirmation resets automatically if the burn address is removed.
- Implementation: `BURN_ADDRESSES` list + `findBurnRecipients()` / `updateBurnWarning()` in `main.js`, gated in `updateSummary()`, with the panel markup in `index.html`.

---

## ✅ What's done well

- **Correct number handling at the money layer:** dispatch and allowance math use `ethers.parseUnits(...)` and `BigInt` (`0n`, `.reduce((sum, amt) => sum + amt, 0n)`). No float precision issues reach the chain.
- **Exact-amount approval:** allowance is checked against the actual required total, and `approve()` targets that exact amount — a safe pattern (minimizes exposure, avoids max-approval).
- **Pre-flight checks:** ETH balance and ERC-20 balance + allowance are verified before broadcasting.
- **Explicit gas estimation with 20–30% buffer** for the dispatch/approval — good practice for smart-wallet/Farcaster-wallet compatibility.
- **Reject-with-context UX:** ignores malformed lines, reports counts of skipped entries, and decodes revert reasons for the user.
- **Clean feature separation** (connect → define → dispatch stepper), defensively resetting state on disconnect and account/chain change.
- **Client-side address checksumming** via `ethers.getAddress`, plus decimal-place validation of amounts.

---

## Top recommendations (priority order)

1. ✅ **Contract source published & reviewed** (`BatchSender.sol`) — now verify each deployed address in `chains.json` on its block explorer, and ideally get an independent audit before large real-money flows.
2. ✅ **Gas-estimation failure now fatal** — no more guaranteed-revert broadcasts.
3. ✅ **Max-recipient cap (500) + burn/dead-address confirmation** added.
4. ⏳ **Debounce `updateSummary`** so allowance checks aren't fired on every keystroke.
5. **Cleanup (minor):** remove `indexold.html`, fix the dead `webhookUrl` in `farcaster.json` (points at a non-existent `/api/webhook`), and add the missing `LICENSE` file the README references.
