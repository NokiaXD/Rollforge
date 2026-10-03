const Database = require('better-sqlite3');
const db = new Database('data/worlds/default/world.db');

// ver todas las columnas
const info = db.prepare("PRAGMA table_info(documents)").all();
console.log('columns:', info.map(c => c.name).join(', '));

// ver una fila completa de folder
const row = db.prepare("SELECT * FROM documents WHERE type='Folder' LIMIT 1").get();
console.log('\nfolder row keys:', Object.keys(row).join(', '));
console.log('folder row sample:', JSON.stringify(row, null, 2));
