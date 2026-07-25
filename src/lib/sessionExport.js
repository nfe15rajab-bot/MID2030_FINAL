// Full-session backup/restore — "Export session" downloads everything the
// active session (Group 2, or an independent Other-group session) has
// saved into one .json file; "Add session" (see IdentityPanel.jsx) reads
// one back in. This is the ONLY portability path for an Other-group
// session (they never sync to Firestore — see sessionScope.js) and a
// backup/cross-machine option for Group 2, which otherwise already syncs
// live.
//
// Every field round-trips through the SAME save function each storage
// module already exposes for real edits (saveSection, saveFicheDetail,
// etc.) — never a bespoke write path — so an import updates localStorage
// and (for Group 2) pushes to Firestore exactly the way a normal edit
// would.
import { loadSection, saveSection } from './sectionStorage.js'
import { loadAllFicheDetails, saveAllFicheDetails } from './ficheStorage.js'
import { getAllMaterialDataEntries, importMaterialDataEntries } from './aiMaterialDataStorage.js'
import { loadAllRouteDistances, saveAllRouteDistances } from './routeDistanceStorage.js'
import { loadOperationalEnergySettings, saveOperationalEnergySettings } from './operationalEnergyStorage.js'
import { loadCustomMaterials, importCustomMaterials } from './customMaterialStorage.js'
import { loadAssemblyGeometry, saveAssemblyGeometry } from './assemblyGeometryStorage.js'
import { getActiveSession } from './sessionScope.js'

const SCHEMA_VERSION = 1
// Every in-scope section — see lcaAnalysis.js's ASSEMBLIES.
const SECTIONS = ['wall', 'roof', 'floor', 'door', 'window', 'skylight']

export function buildSessionExport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    session: getActiveSession(),
    sections: Object.fromEntries(SECTIONS.map((s) => [s, loadSection(s)])),
    assemblyGeometry: Object.fromEntries(SECTIONS.map((s) => [s, loadAssemblyGeometry(s)])),
    fiches: loadAllFicheDetails(),
    materialData: getAllMaterialDataEntries(),
    routeDistances: loadAllRouteDistances(),
    operationalEnergy: loadOperationalEnergySettings(),
    customMaterials: loadCustomMaterials(),
  }
}

export function exportSessionJson(filename) {
  const data = buildSessionExport()
  const label = data.session.group === 'group2' ? 'group2' : (data.session.groupName || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const dateStr = typeof data?.exportedAt === 'string' ? data.exportedAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const name = filename ?? `mid2030-session-${label}-${dateStr}.json`

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Short human-readable summary of an export file's contents — for the confirm-before-import prompt (see IdentityPanel.jsx). Reads only, applies nothing. */
export function summarizeSessionExport(data) {
  const layerCounts = SECTIONS.map((s) => `${data.sections?.[s]?.layers?.length ?? 0} ${s}`).join(', ')
  return {
    layerCounts,
    ficheCount: Object.keys(data.fiches ?? {}).length,
    materialDataCount: (data.materialData ?? []).length,
    exportedAt: data.exportedAt,
    fromSession: data.session,
  }
}

/** Reads and parses a session export File. Throws on an unreadable file or a schema version this app doesn't know how to import. */
export async function readSessionExportFile(file) {
  const text = await file.text()
  const data = JSON.parse(text)
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported session file version (${data.schemaVersion ?? 'unknown'}) — expected ${SCHEMA_VERSION}.`)
  }
  return data
}

/** Writes an imported session's data into the CURRENTLY ACTIVE session — a Group 2 import overwrites the team's real shared data (and syncs it to Firestore), an Other-group import only ever touches that group's own local storage. Caller is responsible for confirming with the user first (see summarizeSessionExport). */
export function applySessionImport(data) {
  for (const s of SECTIONS) {
    if (data.sections?.[s]) saveSection(s, data.sections[s])
    if (data.assemblyGeometry?.[s]) saveAssemblyGeometry(s, data.assemblyGeometry[s])
  }
  if (data.fiches) saveAllFicheDetails(data.fiches)
  if (data.materialData) importMaterialDataEntries(data.materialData)
  if (data.routeDistances) saveAllRouteDistances(data.routeDistances)
  if (data.operationalEnergy) saveOperationalEnergySettings(data.operationalEnergy, data.operationalEnergy.updatedBy)
  if (data.customMaterials) importCustomMaterials(data.customMaterials)
}
