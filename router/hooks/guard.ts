// A hook that gates the person's work (a prompt, a tool call, a subagent, a compaction) never blocks it on the router's
// own bug: an error passes the event on unchanged, or keeps the result already given, and says so once per module life.
// The engine wants each hook a function literal that calls `next` by that name, so a hook wraps its body:
//   on('prompt.submit', async ($, e, next) => shield($, e, next, async go => { ... go(e) ... }))
type Toaster = { ui: { toast: (text: string) => unknown } }

let shown = false

export async function shield<E, R>($: Toaster, e: E, next: (x: E) => Promise<R>, fn: (go: (x: E) => Promise<R>) => Promise<R>): Promise<R> {
  let out: Promise<R> | undefined
  try {
    return await fn(x => (out = next(x)))
  } catch (err) {
    if (!shown) $.ui.toast(`router: skipped routing after an internal error (${String(err).slice(0, 100)})`)
    shown = true
    return out ?? next(e)
  }
}
