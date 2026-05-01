const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'plugin_config.json');
let raw = fs.readFileSync(target, 'utf-8');
if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
    fs.writeFileSync(target, raw, { encoding: 'utf-8' });
    console.log('OK: BOM stripped from', target);
} else {
    console.log('No BOM, file is clean');
}
