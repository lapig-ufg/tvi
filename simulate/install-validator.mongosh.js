// install-validator.mongosh.js
// Instala o schema validator em points (Tier 1.3) no banco corrente.
// Use: mongosh "mongodb://localhost:27019/tvi_sim" --quiet --file simulate/install-validator.mongosh.js
// (porta 27019 é o container docker tvi-sim-mongo / mongo:4.4)

const cmd = {
    collMod: 'points',
    validator: {
        $expr: {
            $eq: [
                { $size: { $ifNull: ['$userName', []] } },
                { $size: { $ifNull: ['$inspection', []] } }
            ]
        }
    },
    validationLevel: 'moderate',
    validationAction: 'warn'
};

print('[install-validator] db=' + db.getName());
print('[install-validator] aplicando collMod...');
const result = db.runCommand(cmd);
print('[install-validator] collMod result: ' + JSON.stringify(result));

const cols = db.getCollectionInfos({ name: 'points' });
const opts = (cols[0] && cols[0].options) || {};
print('');
print('=== Estado de points ===');
print('validator presente: ' + (opts.validator && opts.validator.$expr ? 'SIM' : 'NAO'));
print('validationLevel:    ' + (opts.validationLevel || 'off'));
print('validationAction:   ' + (opts.validationAction || 'warn'));
