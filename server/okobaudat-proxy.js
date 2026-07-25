// STUB — build this out in the next Claude Code session.
//
// Purpose: browser calls to oekobaudat.de will hit CORS, so this small
// server sits between the frontend and the Ökobaudat REST API.
//
// Ökobaudat is soda4LCA-based. Known-good endpoint shape (no auth required):
//   GET https://oekobaudat.de/OEKOBAU.DAT/resource/datastocks/{datastockUUID}/processes
//     ?search=true
//     &compliance={complianceUUID}   // EN 15804+A1 or +A2, see below
//     &name={searchTerm}
//
// Compliance UUIDs (from Ökobaudat developer docs):
//   EN 15804+A1: b00f9ec0-7874-11e3-981f-0800200c9a66
//   EN 15804+A2: c0016b33-8cf7-415c-ac6e-deba0d21440d
//
// Full API docs: https://www.oekobaudat.de/en/guidance/software-developers.html
// (download "Developer Documentation ILCD+EPD v1.2")
//
// TODO next session:
// 1. npm install express node-fetch cors
// 2. Add GET /api/materials/search?q=... that proxies to Ökobaudat,
//    parses the ILCD+EPD JSON response, and returns a slimmed-down shape
//    matching database/schema.md (name, GWP A1-A3, density, declared unit, UUID)
// 3. Add GET /api/materials/:uuid for full process detail once a result is picked
// 4. Cache responses locally (the dataset doesn't change often) to avoid
//    hammering the API during class work

// import express from 'express'
// const app = express()
// ...
