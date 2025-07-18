#!/bin/bash

# Script to setup Tiles API authentication for TVI

echo "=== TVI Tiles API Authentication Setup ==="
echo

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo "ERROR: MongoDB is not running. Please start MongoDB first."
    exit 1
fi

# Get MongoDB connection details
read -p "MongoDB host [localhost]: " MONGO_HOST
MONGO_HOST=${MONGO_HOST:-localhost}

read -p "MongoDB port [27017]: " MONGO_PORT
MONGO_PORT=${MONGO_PORT:-27017}

read -p "MongoDB database [tvi]: " MONGO_DB
MONGO_DB=${MONGO_DB:-tvi}

# Create super-admin user
echo
echo "Creating super-admin user..."

cat > /tmp/create-admin.js << EOF
db = db.getSiblingDB('$MONGO_DB');

// Check if super-admin already exists
var existingAdmin = db.users.findOne({role: 'super-admin'});

if (existingAdmin) {
    print('Super-admin already exists: ' + existingAdmin.username);
    print('Updating password...');
    db.users.update(
        {role: 'super-admin'},
        {\$set: {
            password: 'admin123',
            updatedAt: new Date()
        }}
    );
    print('Password updated to: admin123');
} else {
    // Create new super-admin
    db.users.insert({
        username: 'admin',
        email: 'admin@tvi.local',
        password: 'admin123',
        role: 'super-admin',
        active: true,
        createdAt: new Date()
    });
    print('Super-admin created successfully!');
    print('Username: admin');
    print('Password: admin123');
}

print('');
print('IMPORTANT: Change the password in production!');
EOF

mongo $MONGO_HOST:$MONGO_PORT < /tmp/create-admin.js
rm -f /tmp/create-admin.js

echo
echo "=== Setup Complete ==="
echo
echo "Next steps:"
echo "1. Start the TVI server: npm run dev"
echo "2. Login as admin at: http://localhost:3000/api/admin/login"
echo "   Username: admin"
echo "   Password: admin123"
echo "3. Access the cache manager interface"
echo
echo "For production environments:"
echo "- Change the default password"
echo "- Set TILES_API_URL environment variable if needed"
echo