const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Assuming running in project root
const dbPath = path.resolve(process.cwd(), 'data.sqlite');
console.log(`Opening database at ${dbPath}...`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
        process.exit(1);
    }
    console.log('Connected to database');
});

const tables = [
    'harvester_vm_inventory',
    'harvester_vmi_inventory',
    'harvester_image_inventory',
    'harvester_volume_inventory', // Check if this exists, but safe to try
    'harvester_namespace_inventory',
    'harvester_node_inventory',
    'harvester_service_inventory',
    'harvester_snapshot_inventory',
    'harvester_backup_inventory',
    'kubevirt_volume_inventory', // Possible actual name
    'kubevirt_storage_class_inventory'
];

function cleanTable(tableName) {
    return new Promise((resolve) => {
        const sql = `
            DELETE FROM ${tableName}
            WHERE id NOT IN (
                SELECT MAX(id)
                FROM ${tableName}
                GROUP BY cloudId, uid
            );
        `;
        
        db.run(sql, function(err) {
            if (err) {
                // Ignore "no such table" errors, as we might be guessing names
                if (err.message.includes('no such table')) {
                    console.log(`Skipping ${tableName} (table not found)`);
                } else if (err.message.includes('no such column')) {
                     console.log(`Skipping ${tableName} (schema mismatch: ${err.message})`);
                } else {
                    console.error(`Error cleaning ${tableName}:`, err.message);
                }
            } else {
                if (this.changes > 0) {
                    console.log(`Deleted ${this.changes} duplicate rows from ${tableName}`);
                } else {
                    console.log(`No duplicates found in ${tableName}`);
                }
            }
            resolve();
        });
    });
}

async function run() {
    console.log('Starting cleanup...');
    for (const table of tables) {
        await cleanTable(table);
    }
    
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
    });
}

run();
