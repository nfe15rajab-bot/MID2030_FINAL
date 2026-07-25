import React, { useState } from 'react'
import {
  generateRevitSharedParametersTxt,
  generateRevitScheduleCsv,
  generateRevitBimJsonPayload,
  downloadFile,
} from '../lib/revitExporter.js'
import { analyzeAllAssemblies } from '../lib/assemblyAnalysis.js'
import { loadAssemblyGeometry } from '../lib/assemblyGeometryStorage.js'
import './RevitExportPanel.css'

export default function RevitExportPanel() {
  const [showScript, setShowScript] = useState(false)
  const [copied, setCopied] = useState(false)
  const assemblies = analyzeAllAssemblies()

  const handleExportSharedParams = () => {
    const content = generateRevitSharedParametersTxt()
    downloadFile(content, 'HouseInHaarlem_Revit_SharedParameters.txt', 'text/plain;charset=utf-8')
  }

  const handleExportScheduleCsv = () => {
    const content = generateRevitScheduleCsv()
    downloadFile(content, 'HouseInHaarlem_Revit_LCA_Schedule.csv', 'text/csv;charset=utf-8')
  }

  const handleExportBimJson = () => {
    const content = generateRevitBimJsonPayload()
    downloadFile(content, 'HouseInHaarlem_Revit_Dynamo_BIM_Payload.json', 'application/json;charset=utf-8')
  }

  const dynamoPythonScript = `# Dynamo Python Script to push House in Haarlem LCA/EPD parameters into Revit Family Types
import clr
clr.AddReference('RevitAPI')
from Autodesk.Revit.DB import *
clr.AddReference('RevitServices')
from RevitServices.Persistence import DocumentManager
from RevitServices.Transactions import TransactionManager
import json

doc = DocumentManager.Instance.CurrentDBDocument

# Load JSON BIM Payload exported from applet
json_filepath = "HouseInHaarlem_Revit_Dynamo_BIM_Payload.json"
with open(json_filepath, 'r') as f:
    bim_data = json.load(f)

TransactionManager.Instance.EnsureInTransaction(doc)

updated_types = []
for asm in bim_data['assemblies']:
    category_name = asm['revitCategory']
    type_name = asm['revitFamilyTypeName']
    
    # Collector for target element types
    collector = FilteredElementCollector(doc).WhereElementIsElementType()
    for elem_type in collector:
        if type_name.lower() in elem_type.get_Parameter(BuiltInParameter.SYMBOL_NAME_PARAM).AsString().lower():
            # Apply custom LCA parameters
            param_gwp = elem_type.LookupParameter("LCA_GWP_A1A3_Total_kgCO2e")
            if param_gwp: param_gwp.Set(asm['lcaMetrics']['gwpA1A3TotalKg'])
            
            param_uval = elem_type.LookupParameter("Assembly_UValue_W_m2K")
            if param_uval and asm['buildingPhysics']['uValueWM2K']:
                param_uval.Set(asm['buildingPhysics']['uValueWM2K'])
                
            updated_types.append(type_name)

TransactionManager.Instance.TransactionTaskDone()
OUT = "Successfully updated {} Revit Types".format(len(updated_types))`

  const handleCopyScript = () => {
    navigator.clipboard.writeText(dynamoPythonScript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="revit-export-card">
      <div className="revit-export-header">
        <div className="revit-export-title-group">
          <span style={{ fontSize: '1.5rem' }}>🏢</span>
          <div>
            <h3>Push & Export to Autodesk Revit / BIM</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Direct export of Shared Parameters, Schedule CSV, and Dynamo BIM Scripts
            </span>
          </div>
        </div>
        <span className="revit-badge">Revit 2022–2026 Compatible</span>
      </div>

      <p style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '1.25rem', lineHeight: '1.5' }}>
        Transfer all verified LCA metrics (GWP A1–A3, A4 transport, B4 maintenance, C1–C4 EOL, Module D credits, U-values, and EPD sources) directly into your active 3D Revit architectural model.
      </p>

      <div className="revit-export-actions">
        <button type="button" className="revit-btn revit-btn--primary" onClick={handleExportBimJson}>
          <span>📥</span> Download Revit Dynamo BIM Payload (.json)
        </button>
        <button type="button" className="revit-btn revit-btn--accent" onClick={handleExportScheduleCsv}>
          <span>📊</span> Download Revit LCA Schedule (.csv)
        </button>
        <button type="button" className="revit-btn revit-btn--secondary" onClick={handleExportSharedParams}>
          <span>📄</span> Download Shared Parameters File (.txt)
        </button>
        <button
          type="button"
          className="revit-btn revit-btn--secondary"
          onClick={() => setShowScript(!showScript)}
        >
          <span>🐍</span> {showScript ? 'Hide Dynamo Script' : 'Show Dynamo Sync Script'}
        </button>
      </div>

      <div className="revit-assemblies-grid">
        {assemblies.map((item) => {
          const asmKey = item.key || item.assemblyKey
          const geo = loadAssemblyGeometry(asmKey)
          const area = parseFloat(geo?.surfaceAreaM2) || 0
          const totalA1A3 = item.gwpTotal != null
            ? item.gwpTotal.toFixed(1)
            : item.gwpA1A3PerM2
              ? (item.gwpA1A3PerM2 * area).toFixed(1)
              : '0.0'
          return (
            <div key={asmKey} className="revit-assembly-card">
              <div className="revit-assembly-title">
                <span>{item.label}</span>
                <span className="revit-assembly-owner">{item.owner || 'Unassigned'}</span>
              </div>
              <div className="revit-assembly-stat">
                <span>Area:</span> <strong>{area} m²</strong>
              </div>
              <div className="revit-assembly-stat">
                <span>U-Value:</span> <strong>{item.uValue ? `${item.uValue.toFixed(2)} W/m²K` : '-'}</strong>
              </div>
              <div className="revit-assembly-stat">
                <span>GWP A1-A3:</span> <strong>{totalA1A3} kg CO₂e</strong>
              </div>
            </div>
          )
        })}
      </div>

      {showScript && (
        <div className="revit-script-modal">
          <div className="revit-script-header">
            <span>Dynamo Python Script (Paste in Revit Dynamo Node)</span>
            <button type="button" onClick={handleCopyScript}>
              {copied ? 'Copied!' : 'Copy Script'}
            </button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{dynamoPythonScript}</pre>
        </div>
      )}
    </div>
  )
}
