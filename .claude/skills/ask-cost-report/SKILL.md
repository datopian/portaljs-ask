---
name: ask-cost-report
description: Report PortalJS Ask's AI spend and usage for the month - spend against the limits, questions per portal, cache hits, refusals and errors - with a recommendation on the limits. Use when asked about Ask's costs, usage or limits.
---

# Cost and usage report

## Sources
- Spend and today's count: `curl -s -H "x-ask-admin: $ASK_ADMIN_TOKEN" https://search.portaljs.com/api/data/status`
  (`spentUsd` this month, `questionsToday`, `limits`). Never print the token.
- Events in the Vercel runtime logs for the project (Vercel MCP
  `get_runtime_logs`, or the dashboard). Each line is JSON with an `event`:
  - `ask_ai_usage`: one AI call, with `usd`
  - `ask_plan_ok` / `ask_write_ok`: a live question answered (counted)
  - `ask_plan_cached` / `ask_write_cached`: a repeat, free
  - `ask_refused`: a limit was hit (`refusal`: budget, busy or limit)
  - `ask_check_ok`: the automatic fact check, with the `fixes` it applied
  - `ask_plan_error` / `ask_write_error` / `ask_check_error`: failures
  Logs only go back a limited time on the current plan; say which period you
  could see.

## Report (short, plain words)
1. Spend this month against the app budget (`ASK_MONTHLY_BUDGET_USD`, default
   $40) and the $50 hard cap at Anthropic, and the projected month-end figure.
2. Live questions per portal, the cache hit rate (cached / all), and the
   average cost per live question.
3. Refusals by type, and errors (with the most common error message).
4. Fact check: how many stories needed fixes, and two or three examples of what
   was fixed (from `ask_check_ok`). Recurring slips belong in the portal's
   `notes.md` writing notes or the story prompt.
5. Recommendation: keep the limits, or change a specific one, and why. Limits
   are env vars on Vercel (`ASK_DAILY_TOTAL`, `ASK_DAILY_PER_VISITOR`,
   `ASK_MONTHLY_BUDGET_USD`); the person changes them, not you.
