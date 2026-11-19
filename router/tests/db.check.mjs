// Runs db.ts's real statements through the real runner on a throwaway router.db: node tests/db.check.mjs
// (node 23.6+ loads the .ts directly). The plugin tests stub process.run; this checks the SQL itself.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BOARD, IMPORTED, bucketsOf, dayRow, isAlreadyImported, paths, run, sessionRow, spawnRow, totalsOf, totalsQuery, usageRow } from '../hooks/db.ts'

const home = mkdtempSync(join(tmpdir(), 'router-db-'))
const old = mkdtempSync(join(tmpdir(), 'router-db-0.4-'))
const $ = {
  fs: {
    read: async p => readFileSync(p, 'utf8'),
    write: async (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t) },
  },
  process: {
    run: async ([cmd, ...args], { stdin }) => {
      const r = spawnSync(cmd, args, { input: stdin, encoding: 'utf8' })
      return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
    },
  },
}

try {
  const day = '2026-11-18'
  await run($, home, [
    sessionRow('s1', 'proj', ''), sessionRow('s1', 'proj', 'first prompt'), sessionRow('s1', 'proj', 'later prompt'),
    dayRow(day, 's1', 1, 100), dayRow(day, 's1', 0, 300), dayRow(day, 's1', 1, 200), dayRow(day, 's1', 0, 90, 90),
    usageRow(day, 's1', 'main', 'opus', 1, 2, 0), usageRow(day, 's1', 'main', 'opus', 0.5, 1, 0),
    usageRow(day, 's1', 'router', 'haiku', 0.01, 0, 0.01), usageRow(day, 's1', 'Explore', 'haiku', 0.1, 0.4, 0),
    spawnRow(day, 's1', 'Explore', 1, 1), spawnRow(day, 's1', 'Explore', 0, 1),
    sessionRow('s2', 'other', 'x'), dayRow('2026-11-17', 's2', 1, 50), usageRow('2026-11-17', 's2', 'main', 'opus', 9, 9, 0),
  ])

  const t = totalsOf(await run($, home, totalsQuery('proj')))
  assert.deepEqual(t, { proj: { actualUsd: 1.61, baselineUsd: 3.4, extraUsd: 0.01 }, since: 50 })

  const b = bucketsOf(await run($, home, BOARD)).find(x => x.session === 's1')
  assert.deepEqual(b, {
    day, project: 'proj', session: 's1', label: 'first prompt', first: 90, last: 300, turns: 2,
    byModel: { opus: { usd: 1.5, base: 3, extra: 0, steps: 2 }, haiku: { usd: 0.11, base: 0.4, extra: 0.01, steps: 2 } },
    agents: { Explore: { runs: 2, routed: 1, respawned: 2, usd: 0.1, base: 0.4, extra: 0 } },
  })

  // imported rows carry their own counts
  await run($, home, [usageRow(day, 's3', 'main', 'opus', 1, 1, 0, 5), usageRow(day, 's3', 'main', 'opus', 1, 1, 0, 5), spawnRow(day, 's3', 'Plan', 1, 0, 3), spawnRow(day, 's3', 'Plan', 0, 0, 3)])
  const counts = await run($, home, [{ sql: "SELECT (SELECT steps FROM usage WHERE session = 's3') AS steps, (SELECT runs FROM spawns WHERE session = 's3') AS runs", all: true }])
  assert.deepEqual({ ...counts[0][0] }, { steps: 10, runs: 6 })

  // a bad statement rolls the whole batch back
  await assert.rejects(run($, home, [usageRow(day, 's1', 'main', 'opus', 100, 100, 0), { sql: 'INSERT INTO nope VALUES (1)' }]))
  assert.equal(totalsOf(await run($, home, totalsQuery('proj'))).proj.actualUsd, 1.61)

  // the 0.2 import goes in once: a second batch with the marker rolls back whole
  await run($, home, [IMPORTED, usageRow(day, 'old', 'main', 'opus', 1, 1, 0)])
  const again = await run($, home, [IMPORTED, usageRow(day, 'old', 'main', 'opus', 1, 1, 0)]).catch(e => e)
  assert.equal(isAlreadyImported(again), true)
  const kept = await run($, home, [{ sql: "SELECT usd FROM usage WHERE session = 'old'", all: true }])
  assert.equal(kept[0][0].usd, 1)

  // a batch big enough to arrive in several stdin chunks keeps every non-ASCII character
  const many = Array.from({ length: 3000 }, (_, i) => sessionRow(`ru-${i}`, 'проект', `запрос номер ${i}: почему база падает`))
  await run($, home, many)
  const ru = await run($, home, [{ sql: "SELECT count(*) AS n FROM sessions WHERE id LIKE 'ru-%' AND project = 'проект' AND label LIKE 'запрос номер %: почему база падает'", all: true }])
  assert.equal(ru[0][0].n, 3000)

  // the runner file is written once and kept as is
  assert.equal(readFileSync(join(home, '.claude/router/sqlite.mjs'), 'utf8').startsWith('// written by the router plugin'), true)

  // a 0.4 ledger has no `extra` column: the first batch adds it, old rows read as 0, and a second run is a no-op
  mkdirSync(join(old, '.claude/router'), { recursive: true })
  const d = new DatabaseSync(paths(old).db)
  d.exec('CREATE TABLE usage (day TEXT, session TEXT, who TEXT, model TEXT, steps INTEGER NOT NULL, usd REAL NOT NULL, base REAL NOT NULL, PRIMARY KEY (day, session, who, model)) WITHOUT ROWID')
  d.exec(`INSERT INTO usage VALUES ('${day}', 'o1', 'main', 'opus', 1, 2, 3)`)
  d.close()
  await run($, old, [sessionRow('o1', 'proj', 'x'), usageRow(day, 'o1', 'main', 'opus', 1, 0.5, 0.5)])
  await run($, old, [])
  assert.deepEqual(totalsOf(await run($, old, totalsQuery('proj'))).proj, { actualUsd: 3, baselineUsd: 3.5, extraUsd: 0.5 })
  console.log('db check: ok')
} finally {
  rmSync(home, { recursive: true, force: true })
  rmSync(old, { recursive: true, force: true })
}
