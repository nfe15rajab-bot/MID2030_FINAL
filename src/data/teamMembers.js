// Group 02 members who can be attributed as the owner of a saved section or research lead.
export const TEAM_MEMBERS = ['Nada', 'Sukriti', 'Moamen', 'Michael', 'Hinal', 'Alejandro']

export const TEAM_ROLES = {
  Nada: {
    name: 'Nada',
    role: 'App Admin & Skylight Lead',
    isAdmin: true,
    assemblyKey: 'skylight',
    scope: 'Skylight Assembly & Application Administration',
  },
  Moamen: {
    name: 'Moamen',
    role: 'Floor Assembly Lead',
    isAdmin: false,
    assemblyKey: 'floor',
    scope: 'Floor Assembly & Substructure',
  },
  Sukriti: {
    name: 'Sukriti',
    role: 'Wall Assembly Lead',
    isAdmin: false,
    assemblyKey: 'wall',
    scope: 'Wall Assembly & Facade Cladding',
  },
  Alejandro: {
    name: 'Alejandro',
    role: 'Roof Assembly Lead',
    isAdmin: false,
    assemblyKey: 'roof',
    scope: 'Roof Assembly & Green Roof System',
  },
  Michael: {
    name: 'Michael',
    role: 'Window & Door Lead',
    isAdmin: false,
    assemblyKeys: ['window', 'door'],
    scope: 'Window & Door Systems (Schüco)',
  },
  Hinal: {
    name: 'Hinal',
    role: 'Material Research Lead',
    isAdmin: false,
    scope: 'Fiche Technique, Materials Catalog & Provider Database',
  },
}

export const DEFAULT_SECTION_OWNERS = {
  wall: 'Sukriti',
  roof: 'Alejandro',
  floor: 'Moamen',
  door: 'Michael',
  window: 'Michael',
  skylight: 'Nada',
}

