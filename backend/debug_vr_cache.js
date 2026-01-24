const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

const uuid = '669741676840656896';
const query = `SELECT * FROM vr_cache_extended WHERE uuid = ?`;

console.log(`Checking VR3 Info (vr_cache_extended) for UUID: ${uuid}`);

db.get(query, [uuid], (err, row) => {
  if (err) {
    console.error('Query error:', err.message);
  } else if (row) {
    console.log('Found VR Cache Extended Info:');
    try {
        const data = JSON.parse(row.data);
        console.log(JSON.stringify(data, null, 2));
    } catch(e) {
        console.log('Raw Data (Parse Failed):', row.data);
    }
  } else {
    console.log('No VR Cache Extended Info found for UUID:', uuid);
  }
  
  // Also check basic cache
  const basicQuery = `SELECT * FROM vr_list_cache WHERE uuid = ?`;
  db.get(basicQuery, [uuid], (err2, row2) => {
      if (row2) {
          console.log('\nFound in VR List Cache (Basic Info):');
          // Just show keys to avoid huge output if any
          console.log(Object.keys(row2));
          if (row2.vr3_info) {
             console.log('Has vr3_info column in basic cache:', row2.vr3_info ? 'Yes (Length: ' + row2.vr3_info.length + ')' : 'No');
          }
      } else {
          console.log('\nNot found in VR List Cache either.');
      }
      db.close();
  });
});
