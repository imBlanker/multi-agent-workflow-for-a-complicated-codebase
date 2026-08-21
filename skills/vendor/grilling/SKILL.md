---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**

<question body, might be multiple paragraphs>

- **(a)** <first option>
- **(b)** <second option>
- **(c)** <third option>

➡️ **Recommended: (a)** — <why it is the right call>
```

Formatting is part of the contract, not decoration:

- **Lettered choices are list items, one per line.** Never inline two or more options into the body paragraph — the reader must be able to see where each option starts. Only a single, trivial binary may stay inline if it reads naturally.
- **The title line carries the subject only**; context and details go in the body below it.
- **The recommendation must be concrete and visible on the line itself**: lead with the chosen option (echo its letter when the body offers lettered choices, otherwise a short phrase naming the pick), then the justification. An empty recommendation — a bare `推荐：。` / `Recommended:.` with only the reason following — is a format violation. If you genuinely cannot recommend yet, say so explicitly on that line and name what blocks the recommendation.

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
