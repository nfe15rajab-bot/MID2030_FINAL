# materials.json — record shape

Each entry represents one material as used in an assembly layer. This mirrors
the columns already in your `group2` / `assembly_*` Excel tabs so the app can
eventually import/export against the same file.

```jsonc
{
  "id": "string, slug, unique",           // e.g. "spruce-board-t6"
  "name": "string",                       // display name
  "category": "string",                   // Foundation | Floor | Wall | Roof | ...
  "discipline": "string",                 // Structure | Insulation | Sheathing | Membrane |
                                           // Cladding | Finishing | Roofing | Fixed Unit —
                                           // used to group materials in the Providers tab
  "manufacturer": "string",
  "providerLocation": "string",           // city, country
  "distanceToDetmoldKm": "number | null",  // leg 1 (manufacturer -> Detmold)
  "distanceDetmoldToSiteKm": 370,          // leg 2, fixed per project
  "transportMode": "string",              // road | rail | sea | multimodal
  "enNorm": "string",                     // EN technical norm (col H)
  "thicknessMM": "number | null",         // default/typical, editable per layer instance
  "densityKgM3": "number | null",
  "thermalConductivityWmK": "number | null", // λ, for U-value calc
  "gwpA1A3PerFunctionalUnit": "number | null", // kg CO2e / functional unit
  "functionalUnit": "string",             // e.g. "kg", "m2", "m3"
  "okobaudatUUID": "string | null",       // link to source Ökobaudat process, once looked up
  "epdSource": "string | null",           // EPD reference / publisher
  "notes": "string | null"                // e.g. flagged items (Forbo linoleum, Metsä plywood)
}
```

Layer *instances* in an assembly (what the user builds in the app) reference
a material `id` plus an assembly-specific `thicknessMM` and `order` — they
don't duplicate the material record.

## providers.json — record shape

A material can have several candidate providers (e.g. two manufacturers who
both sell OSB board). This is what the map tool searches over to find the
closest one to each destination.

```jsonc
{
  "id": "string, slug, unique",
  "materialIds": ["osb-board-t18"],       // which material(s) this provider supplies
  "name": "string",                        // manufacturer/supplier name
  "address": "string",                     // full address for geocoding
  "website": "string | null",              // for the fiche technique's "Provider's website" row
  "lat": "number | null",                  // filled by geocoding step
  "lng": "number | null",
  "distanceToDetmoldKm": "number | null",  // filled by routing step (HGV profile)
  "distanceToSiteKm": "number | null",     // direct provider -> Haarlem site, if ever needed
  "geocodedAt": "ISO date string | null"
}
```

## Fiche technique detail — record shape (client-side only, not a file)

Per-material fields the fiche technique editor collects that aren't reliably
in Ökobaudat/materials.json — researched/typed by hand, optionally via the
AI-assisted "Suggest" flow (`server/material-autofill-server.js`). Stored in
`localStorage` (`src/lib/ficheStorage.js`), keyed by material id — not a
dataset file, so it doesn't ship with the repo or sync across machines.

```jsonc
{
  "germanName": "string",
  "specs": "string",                      // freeform technical description
  "norm": "string",                       // DIN/EN reference, pre-filled from materials.json's enNorm if present
  "photoDataUrl": "string | null",        // uploaded photo, embedded as a data URL
  "providerName": "string",               // manual fallback, used only if providers.json has no match
  "providerLocation": "string",
  "providerWebsite": "string",
  "providerDistanceKm": "string",
  "endOfLifeScenario": "'' | 'Reuse' | 'Recycle' | 'Downcycle' | 'Energy recovery (incineration)' | 'Landfill/disposal'",
  "endOfLifeNotes": "string",             // e.g. "mechanically fixed, easily separable"
  "endOfLifeConfidence": "'high' | 'medium' | 'low' | null",
  "endOfLifeConfidenceLabel": "string | null",
  "endOfLifeSource": "string | null"      // URL — kept even after acceptance, unlike the other AI-suggested fields above
}
```

Every other AI-suggested field (germanName/specs/norm/providerWebsite/λ/GWP)
shows its confidence+source only transiently during the suggest-review step,
then discards them once accepted — the plain value is all that's kept, same
as if the user had typed it themselves. End-of-life is the one exception:
its confidence+source persist permanently, because the LCA tab's C&D summary
needs to know how trustworthy each layer's scenario is, not just what it
says. A manual edit to endOfLifeScenario/endOfLifeNotes after accepting a
suggestion clears confidence/source rather than leaving them stale.

## Fixed reference points

- **Detmold factory**: approximate city coordinates 51.9366, 8.8779 —
  REPLACE with the exact factory address once known, then re-geocode.
- **Model 1 site**: Batavierenplantsoen, Haarlem, Netherlands — needs
  geocoding to an exact lat/lng (not yet done in this scaffold).
