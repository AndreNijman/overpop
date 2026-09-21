import { loadGame } from '../loadgame.mjs'

export const name = 'backup'
export const needs = ['js/save.js', 'js/ui/menus.js']

function fixture () {
  const env = loadGame()
  const app = env.OP.App
  app.state.profile = env.OP.Save.defaults()
  app.state.io = env.OP.Input.create()
  app.state.view = env.OP.Camera.create()
  return { ...env, app }
}

export async function run (t) {
  const source = fixture()
  const { OP, app } = source
  OP.Legends.start(app.state.profile, 'portable-save', { picks: ['sharpen'] })
  app.state.profile.knowledgePoints = 17
  const sim = app.launchLegendsBattle()
  OP.Sim.startRound(sim)
  OP.Sim.run(sim, 100)
  t.ok(app.saveRun(), 'source encounter saves')
  const text = OP.Save.exportBackup(app.state.profile)
  t.ok(typeof text === 'string', 'backup exports as portable JSON')
  const target = fixture()
  const Save = target.OP.Save
  const storage = target.ctx.localStorage
  t.ok(Save.importBackup(text).ok, 'a fresh browser imports the backup')
  target.app.state.profile = Save.load()
  const restored = target.app.resumeGame()
  t.eq(target.app.state.profile.knowledgePoints, 17, 'profile progression survives import')
  t.eq(restored.runId, sim.runId, 'saved run identity survives import')
  t.eq(target.OP.Sim.checksum(restored), OP.Sim.checksum(sim), 'the imported encounter has the same simulation state')
  t.deep(restored.roundSet, sim.roundSet, 'custom encounter rounds survive export/import')

  t.section('invalid and future backups cannot erase existing progress')
  const before = storage._dump()
  const future = JSON.parse(text)
  future.profile.schemaVersion = 999
  const brokenRun = JSON.parse(text)
  brokenRun.run.snapshot.towers = [null]
  for (const bad of ['{', 'null', '{}', JSON.stringify(future), JSON.stringify(brokenRun)]) {
    t.notOk(Save.importBackup(bad).ok, 'invalid backup is rejected')
    t.deep(storage._dump(), before, 'rejection changes no stored bytes')
  }

  t.section('interrupted imports retain a coherent old profile and run')
  const other = JSON.parse(text)
  other.profile.knowledgePoints = 99
  other.run.snapshot.cash = 9999
  const realSet = storage.setItem
  storage.setItem = (key, value) => {
    if (key === Save.RUN_KEY) throw new Error('QuotaExceededError')
    realSet(key, value)
  }
  try {
    t.notOk(Save.importBackup(JSON.stringify(other)).ok, 'a partial storage write reports failure')
    t.eq(Save.load().knowledgePoints, 17, 'readers still see the original profile')
    t.eq(Save.loadRun().snapshot.cash, sim.cash, 'readers still see its original run')
    const cold = fixture()
    for (const [key, value] of Object.entries(storage._dump())) cold.ctx.localStorage.setItem(key, value)
    t.eq(cold.OP.Save.load().knowledgePoints, 17, 'a cold reload sees the original profile too')
    t.eq(cold.OP.Save.loadRun().snapshot.cash, sim.cash, 'a cold reload sees the matching original run')
  } finally { storage.setItem = realSet }
  t.ok(Save.save(Save.load()), 'a later successful write recovers the interrupted import')
  t.eq(storage.getItem(Save.IMPORT_JOURNAL_KEY), null, 'successful recovery clears the journal')

  t.section('Settings imports through the file picker and exposes backup controls')
  target.app.state.sim = null
  target.OP.Menus.go(target.app, 'settings')
  const model = target.OP.Menus.build(target.app)
  t.ok(model.widgets.some(w => w.action === 'export-backup'), 'Settings exposes export')
  const realURL = target.ctx.URL
  target.ctx.Blob = Blob
  let download
  target.ctx.URL = {
    createObjectURL: blob => { download = blob; return 'blob:backup-test' },
    revokeObjectURL: () => {}
  }
  try {
    target.OP.Menus.activate(target.app, { action: 'export-backup' })
    t.ok(download, 'the export button creates a downloadable file')
    const downloaded = JSON.parse(await download.text())
    t.eq(downloaded.profile.knowledgePoints, 17, 'download contains the current profile')
    t.eq(downloaded.run.snapshot.runId, sim.runId, 'download includes the matching saved run')
    await new Promise(resolve => setTimeout(resolve, 1100))
  } finally { target.ctx.URL = realURL }
  const button = model.widgets.find(w => w.action === 'import-backup')
  t.ok(button && !button.disabled, 'Settings exposes import')
  const realCreate = target.ctx.document.createElement
  let input
  target.ctx.document.createElement = tag => {
    const element = realCreate(tag)
    if (tag === 'input') input = element
    return element
  }
  try {
    target.OP.Menus.activate(target.app, button)
    input.files = [{ text: async () => JSON.stringify(other) }]
    await input.onchange()
    t.eq(target.app.state.profile.knowledgePoints, 99, 'file-picker import refreshes the live profile')
    t.eq(Save.loadRun().snapshot.cash, 9999, 'file-picker import restores the saved run')
    t.ok(target.OP.Menus.state.notice.includes('Backup imported'), 'Settings reports successful import')
    input.files = [{ text: async () => '{broken' }]
    await input.onchange()
    t.eq(target.app.state.profile.knowledgePoints, 99, 'invalid file does not replace the live profile')
    t.eq(Save.load().knowledgePoints, 99, 'invalid file does not replace the stored profile')
  } finally { target.ctx.document.createElement = realCreate }

  t.section('a profile-only backup intentionally removes the old saved run')
  other.run = null
  t.ok(Save.importBackup(JSON.stringify(other)).ok, 'profile-only backup imports')
  t.notOk(Save.hasRun(), 'the previous run is not attached to the imported profile')
  t.eq(storage.getItem(Save.RUN_BACKUP_KEY), null, 'the previous recovery checkpoint is also removed')
}
