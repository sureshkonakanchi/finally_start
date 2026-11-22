# FinAlly — Integration Issues

Maintained by the Integration Tester. Format:
`ISSUE-NNN | owner role | severity | status | repro | expected/actual`

Severity: critical (blocks core flow) / major (spec/contract violation) / minor (cosmetic, edge case).
Status: open / fixed / wontfix.

| ID | Owner | Severity | Status | Repro | Expected / Actual |
|---|---|---|---|---|---|
| ISSUE-001 | Frontend Engineer | major (env/process, not a code defect) | open | At ~17:17 `frontend/out/` was deleted while `next dev -p 3000` (PID 25084/25380, started 17:15) kept running from `frontend/`. Two `next build` runs started afterwards (17:25 PID 6620, and 17:34 PID 7092, the Integration Tester's) hang indefinitely after the "Next.js 15.5.29" banner. `.next/` has not changed since 17:25. | Expected: `npm run build` finishes and recreates `frontend/out/index.html`. Actual: the builds hang and `out/` stays missing, so the backend returns `{"detail":"Frontend not built"}` at `/` and every UI test fails in `openApp`. Likely cause: `next dev` and `next build` share `.next/` and Windows file locks. Fix: stop `next dev` before building, or set a separate `distDir` for dev. Stop the hung build processes too. |

## Test run log

- 2026-11-21 run 1 (fresh DB, `E2E_FRESH_DB=true`, LLM_MOCK, local uvicorn and the `frontend/out` build from ~15:40): **57/57 passed** (1.6 min). Server log had no 5xx responses and no tracebacks.
- 2026-11-21 run 2 (same server, DB already used, to check that tests do not depend on order or state): 56/57. The one failure was `chat > send a message and get an assistant reply`, and it was environmental: the page showed "Frontend not built" because `frontend/out` was deleted mid-run (ISSUE-001). That test passed when re-run on its own.
- No app defects found against the API contract (TEAM.md section 3) or the data-testid contract (section 4).
