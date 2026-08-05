// @ts-check
// A tiny graph workflow model. Nodes are units of work; edges are transitions
// (fixed or conditional). The graph is declarative structure over imperative
// node bodies, mirroring the LangGraph mental model: structure is a graph, the
// path through it can be fully dynamic via conditional edges, and designated
// nodes can loop. This module provides topology ordering, validation, and the
// ability to render execution batches (parallel groups separated by gates).

/**
 * @typedef {"task"|"review"|"gate"|"loop"|"subagent"|"parallel-fanout"|"reduce"} NodeKind
 * @typedef {{ id: string, role?: string, agent?: string, kind: NodeKind, description?: string, loop?: { maxIterations: number, exitWhen?: string }, review?: { by?: string, scope?: string }, parallel?: { fanout: number }, tools?: string[], costRateLimitUsdPerMin?: number, concurrency?: number }} WFNode
 * @typedef {{ from: string, to: string, condition?: string, label?: string }} WFEdge
 */

export class WorkflowGraph {
  /** @param {{ id?: string, name?: string, nodes?: WFNode[], edges?: WFEdge[], meta?: Record<string,any> }} [init] */
  constructor(init = {}) {
    this.id = init.id || "wf";
    this.name = init.name || "workflow";
    this.meta = init.meta || {};
    /** @type {WFNode[]} */
    this.nodes = init.nodes || [];
    /** @type {WFEdge[]} */
    this.edges = init.edges || [];
  }

  /** @param {WFNode} n */
  addNode(n) {
    if (this.nodes.some((x) => x.id === n.id)) throw new Error(`duplicate node id: ${n.id}`);
    this.nodes.push(n);
    return n;
  }
  /** @param {WFEdge} e */
  addEdge(e) {
    this.edges.push(e);
    return e;
  }

  /** @param {string} id */
  node(id) {
    return this.nodes.find((n) => n.id === id) || null;
  }

  /** @param {string} id */
  outEdges(id) {
    return this.edges.filter((e) => e.from === id);
  }
  /** @param {string} id */
  inEdges(id) {
    return this.edges.filter((e) => e.to === id);
  }

  roots() {
    return this.nodes.filter((n) => this.inEdges(n.id).length === 0);
  }

  /**
   * Validate: every edge endpoint exists; no unintended cycles except through
   * explicit `loop` nodes; every node reachable from a root.
   * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
   */
  validate() {
    const errors = [];
    const warnings = [];
    const ids = new Set(this.nodes.map((n) => n.id));
    for (const e of this.edges) {
      if (!ids.has(e.from)) errors.push(`edge from unknown node: ${e.from}`);
      if (!ids.has(e.to)) errors.push(`edge to unknown node: ${e.to}`);
    }
    // reachability from roots
    const roots = this.roots();
    if (roots.length === 0 && this.nodes.length > 0) errors.push("no root node (cycle with no entry)");
    const visited = new Set();
    const stack = roots.map((r) => r.id);
    while (stack.length) {
      const id = /** @type {string} */ (stack.pop());
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of this.outEdges(id)) stack.push(e.to);
    }
    for (const n of this.nodes) if (!visited.has(n.id)) warnings.push(`unreachable node: ${n.id}`);

    // cycle detection that permits loop nodes
    const loopNodes = new Set(this.nodes.filter((n) => n.kind === "loop").map((n) => n.id));
    const color = new Map(); // 0=white,1=gray,2=black
    let cycleErr = false;
    const dfs = (/** @type {string} */ id) => {
      color.set(id, 1);
      for (const e of this.outEdges(id)) {
        const isLoopBack = loopNodes.has(e.from) && e.to === e.from;
        if (isLoopBack) continue;
        const c = color.get(e.to) || 0;
        if (c === 1) { cycleErr = true; errors.push(`cycle detected through ${e.from} -> ${e.to} (only loop nodes may self-reference)`); }
        else if (c === 0) dfs(e.to);
      }
      color.set(id, 2);
    };
    for (const r of roots) dfs(r.id);
    if (cycleErr) errors.push("graph contains an unexpected cycle");
    return { ok: errors.length === 0, errors, warnings };
  }

  /**
   * Compute execution batches: groups of nodes that can run in parallel, with
   * review/gate nodes forcing a batch boundary. Respects data dependencies.
   * Loop nodes expand into their declared max iterations.
   * @returns {{ batches: WFNode[][], notes: string[] }}
   */
  topoBatches() {
    const notes = [];
    const indeg = new Map(this.nodes.map((n) => [n.id, this.inEdges(n.id).length]));
    const ready = this.nodes.filter((n) => (indeg.get(n.id) || 0) === 0 && n.kind !== "loop-self");
    const batches = [];
    const done = new Set();
    // simple Kahn-style batching with gate boundaries
    let current = /** @type {WFNode[]} */ ([]);
    const emit = () => { if (current.length) { batches.push(current); current = []; } };

    const queue = [...ready].sort((a, b) => (a.id < b.id ? -1 : 1));
    // We process by repeatedly taking all zero-indegree nodes as one batch,
    // except review/gate nodes always sit alone as their own batch.
    while (queue.length) {
      // pick all currently-ready non-gate nodes into one parallel batch
      const gateless = [];
      const gates = [];
      for (const n of queue) (n.kind === "review" || n.kind === "gate" ? gates : gateless).push(n);
      for (const g of gates) {
        if (gateless.length) { batches.push(gateless.splice(0)); }
        batches.push([g]);
        done.add(g.id);
        // decrement successors
        for (const e of this.outEdges(g.id)) {
          indeg.set(e.to, (indeg.get(e.to) || 1) - 1);
        }
      }
      // expand loop nodes into their iteration count within the batch
      for (const n of gateless) {
        if (n.kind === "loop" && n.loop?.maxIterations) {
          for (let i = 1; i <= n.loop.maxIterations; i++) {
            current.push({ ...n, id: `${n.id}#iter${i}`, description: `${n.description || n.id} (iteration ${i}/${n.loop.maxIterations})` });
          }
        } else {
          current.push(n);
        }
        done.add(n.id);
      }
      if (gateless.length) { emit(); }
      // recompute ready set
      queue.length = 0;
      for (const n of this.nodes) {
        if (done.has(n.id)) continue;
        let need = 0;
        for (const e of this.inEdges(n.id)) if (!done.has(e.from) && !(e.from === n.id && n.kind === "loop")) need++;
        if (need === 0) queue.push(n);
      }
      queue.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!queue.length && done.size < this.nodes.length) {
        notes.push("remaining nodes are gated by a cycle or unsatisfied dependencies");
        break;
      }
    }
    return { batches, notes };
  }

  toJSON() {
    return { id: this.id, name: this.name, meta: this.meta, nodes: this.nodes, edges: this.edges };
  }
}

/**
 * Build a canonical graph from a plan (used by configgen + planner).
 * @param {{ agents: any[], groups: any[], reviewPoints: any[], loops: any[] }} plan
 * @param {{ parallelGroups: string[][] }} [extra]
 */
export function graphFromPlan(plan) {
  const g = new WorkflowGraph({ id: "wf", name: plan.name || "workflow" });
  let i = 0;
  const prev = [];
  for (const group of plan.groups || []) {
    const isParallel = group.parallel === true;
    const ids = (group.steps || group.agents || []).map((/** @type {any} */ s) => {
      const id = `n${++i}`;
      const role = typeof s === "string" ? s : s.role;
      g.addNode({
        id,
        role,
        agent: typeof s === "object" && s.agent ? s.agent : role,
        kind: isParallel ? "parallel-fanout" : "task",
        description: typeof s === "object" && s.task ? s.task : `${role} work`,
      });
      return id;
    });
    for (const p of prev) for (const id of ids) g.addEdge({ from: p, to: id });
    prev.length = 0;
    prev.push(...ids);
  }
  // review gates
  for (const rp of plan.reviewPoints || []) {
    const id = `r${++i}`;
    g.addNode({ id, kind: "review", review: { by: rp.by || "codex", scope: rp.scope || "auto" }, description: rp.label || "review gate" });
    for (const p of prev) g.addEdge({ from: p, to: id });
    prev.length = 0;
    prev.push(id);
  }
  // loops
  for (const lp of plan.loops || []) {
    const id = `l${++i}`;
    g.addNode({ id, kind: "loop", loop: { maxIterations: lp.maxIterations || 3, exitWhen: lp.exitWhen }, description: lp.label || "refinement loop" });
    for (const p of prev) g.addEdge({ from: p, to: id });
    g.addEdge({ from: id, to: id }); // self edge (allowed for loop nodes)
    prev.length = 0;
    prev.push(id);
  }
  return g;
}
