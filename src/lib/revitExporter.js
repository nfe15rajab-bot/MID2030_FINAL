import { analyzeAllAssemblies } from './assemblyAnalysis.js'
import { loadAssemblyGeometry } from './assemblyGeometryStorage.js'
import { getEpdReferenceList } from './epdReferenceList.js'

/**
 * Generates a standard Autodesk Revit Shared Parameters File (.txt)
 * defining custom LCA/EPD parameters for Revit elements.
 */
export function generateRevitSharedParametersTxt() {
  const fileLines = [
    '# This is a Revit shared parameter file.',
    '# Do not edit manually unless you know what you are doing.',
    '*META\tVERSION\tMINVERSION',
    'META\t2\t1',
    '*GROUP\tID\tNAME',
    'GROUP\t1\tLCA_EPD_Parameters',
    'GROUP\t2\tBuilding_Physics_Parameters',
    '*PARAM\tGUID\tNAME\tDATATYPE\tDATACONTROL\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE\tGUIDANCE',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a111111\tLCA_GWP_A1A3_kgCO2e_m2\tNUMBER\t\t1\t1\tGWP A1-A3 Embodied Carbon per m2 (kg CO2e/m2)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a222222\tLCA_GWP_A1A3_Total_kgCO2e\tNUMBER\t\t1\t1\tGWP A1-A3 Total Embodied Carbon (kg CO2e)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a333333\tLCA_GWP_A4_Transport_kgCO2e\tNUMBER\t\t1\t1\tGWP A4 Transport Carbon (kg CO2e)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a444444\tLCA_GWP_B4_Replacement_kgCO2e\tNUMBER\t\t1\t1\tGWP B4 Replacement/Maintenance Carbon over 50yr (kg CO2e)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a555555\tLCA_GWP_C1C4_EOL_kgCO2e\tNUMBER\t\t1\t1\tGWP C1-C4 End of Life Carbon (kg CO2e)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a666666\tLCA_GWP_ModuleD_Credit_kgCO2e\tNUMBER\t\t1\t1\tGWP Module D Net Recycling Credit (kg CO2e)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a777777\tLCA_Reference_Service_Life_Years\tINTEGER\t\t1\t1\tReference Service Life (Years)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a888888\tLCA_EPD_Primary_Source\tTEXT\t\t1\t1\tPrimary EPD Document Identifier\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421a999999\tLCA_Assembly_Owner\tTEXT\t\t1\t1\tAssigned Assembly Team Owner\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421b000000\tAssembly_UValue_W_m2K\tNUMBER\t\t2\t1\tThermal Transmittance U-Value (W/m2K)\t1\t',
    'PARAM\t0b42f61a-0a1b-4d32-841f-8e421b111111\tAssembly_Thickness_mm\tNUMBER\t\t2\t1\tTotal Assembly Thickness (mm)\t1\t',
  ]
  return fileLines.join('\r\n')
}

/**
 * Generates a CSV schedule file ready for import into Revit / Dynamo or Excel
 */
export function generateRevitScheduleCsv() {
  const assemblies = analyzeAllAssemblies()
  const headers = [
    'Revit Category',
    'Assembly Name',
    'Assembly Key',
    'Owner',
    'Surface Area (m2)',
    'Volume (m3)',
    'Thickness (mm)',
    'U-Value / Uw (W/m2K)',
    'GWP A1-A3 (kg CO2e/m2)',
    'GWP A1-A3 Total (kg CO2e)',
    'GWP A4 Transport (kg CO2e)',
    'GWP B4 Replacement (kg CO2e)',
    'GWP C1-C4 EOL (kg CO2e)',
    'GWP Module D Credit (kg CO2e)',
    'Service Life (Years)',
    'Primary EPD / Spec Reference',
    'Layer / Component Structure',
  ]

  const rows = [headers.join(',')]

  for (const item of assemblies) {
    const asmKey = item.key || item.assemblyKey
    const geo = loadAssemblyGeometry(asmKey)
    const area = parseFloat(geo?.surfaceAreaM2) || 0
    const volume = parseFloat(geo?.volumeM3) || 0
    const totalA1A3Val = item.gwpTotal ?? (item.gwpA1A3PerM2 ? item.gwpA1A3PerM2 * area : 0)
    const totalA1A3Kg = totalA1A3Val ? totalA1A3Val.toFixed(2) : '0.00'
    const gwpPerM2 = area > 0 ? (totalA1A3Val / area).toFixed(2) : (item.gwpA1A3PerM2 ? item.gwpA1A3PerM2.toFixed(2) : '0.00')

    const revitCategory = {
      wall: 'Walls',
      roof: 'Roofs',
      floor: 'Floors',
      door: 'Doors',
      window: 'Windows',
      skylight: 'Roofs / Skylights',
    }[asmKey] || 'Specialty Equipment'

    const layerList = item.layers || item.layerResults || []
    const layerSummary = layerList.length > 0
      ? layerList.map(l => `${l.name} (${l.thicknessMM || '-'}mm)`).join(' | ')
      : 'Unit System'

    const row = [
      `"${revitCategory}"`,
      `"${item.label}"`,
      `"${asmKey}"`,
      `"${item.owner || 'Unassigned'}"`,
      area.toFixed(2),
      volume.toFixed(2),
      item.totalThicknessMM ? item.totalThicknessMM.toFixed(1) : '-',
      item.uValue ? item.uValue.toFixed(3) : '-',
      gwpPerM2,
      totalA1A3Kg,
      (item.gwpA4TotalKg || 0).toFixed(2),
      (item.gwpB4TotalKg || 0).toFixed(2),
      (item.gwpC1C4TotalKg || 0).toFixed(2),
      (item.gwpModuleDTotalKg || 0).toFixed(2),
      item.serviceLifeYears || 50,
      `"${item.epdSource || 'Project Spec'}"`,
      `"${layerSummary}"`,
    ]

    rows.push(row.join(','))
  }

  return rows.join('\r\n')
}

/**
 * Generates a full Revit / Dynamo JSON BIM payload for direct automated property injection.
 */
export function generateRevitBimJsonPayload() {
  const assemblies = analyzeAllAssemblies()
  const epdList = getEpdReferenceList()

  const bimData = {
    schemaVersion: '1.0',
    exportTimestamp: new Date().toISOString(),
    project: 'House in Haarlem — Group 2',
    location: 'Haarlem, Netherlands',
    units: {
      length: 'mm',
      area: 'm2',
      volume: 'm3',
      carbon: 'kg CO2e',
      uValue: 'W/m2K',
    },
    assemblies: assemblies.map((item) => {
      const asmKey = item.key || item.assemblyKey
      const geo = loadAssemblyGeometry(asmKey)
      const area = parseFloat(geo?.surfaceAreaM2) || 0
      const totalA1A3Kg = item.gwpTotal ?? (item.gwpA1A3PerM2 ? item.gwpA1A3PerM2 * area : 0)
      const layerList = item.layers || item.layerResults || []
      return {
        assemblyKey: asmKey,
        revitCategory: {
          wall: 'Walls',
          roof: 'Roofs',
          floor: 'Floors',
          door: 'Doors',
          window: 'Windows',
          skylight: 'Roofs / Skylights',
        }[asmKey] || 'Specialty Equipment',
        revitFamilyTypeName: item.label,
        assignedOwner: item.owner || 'Unassigned',
        geometry: {
          surfaceAreaM2: area,
          volumeM3: parseFloat(geo?.volumeM3) || 0,
          totalThicknessMM: item.totalThicknessMM || 0,
        },
        buildingPhysics: {
          uValueWM2K: item.uValue || null,
          rValueM2KW: item.rValue || null,
        },
        lcaMetrics: {
          gwpA1A3PerM2: area > 0 ? parseFloat((totalA1A3Kg / area).toFixed(2)) : (item.gwpA1A3PerM2 || 0),
          gwpA1A3TotalKg: totalA1A3Kg,
          gwpA4TransportKg: item.gwpA4TotalKg || 0,
          gwpB4ReplacementKg: item.gwpB4TotalKg || 0,
          gwpC1C4EolKg: item.gwpC1C4TotalKg || 0,
          gwpModuleDCreditKg: item.gwpModuleDTotalKg || 0,
          serviceLifeYears: item.serviceLifeYears || 50,
        },
        layers: layerList.map((layer) => ({
          materialId: layer.materialId,
          name: layer.name,
          role: layer.role,
          thicknessMM: layer.thicknessMM,
          densityKgM3: layer.densityKgM3,
          thermalConductivityWmK: layer.thermalConductivityWmK ?? layer.lambda,
          gwpA1A3PerUnit: layer.gwpA1A3PerUnit ?? layer.gwp,
          unit: layer.unit,
        })),
      }
    }),
    epdCatalog: epdList,
  }

  return JSON.stringify(bimData, null, 2)
}

/** Helper function to download plain text or blob files in browser */
export function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
