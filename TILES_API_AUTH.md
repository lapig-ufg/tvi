# Tiles API Authentication Configuration

## Problem
The cache manager is receiving authentication errors when trying to connect to the Tiles API:
```json
{
  "error": "Authentication required",
  "details": "Missing or invalid Authorization header"
}
```

## Root Cause
The Tiles API requires Basic HTTP authentication with:
- Username: either the `username` or `_id` field from MongoDB users collection
- Password: plain text or SHA256 hashed
- User must have role "super-admin" or type "admin"

The TVI server was not storing the admin password in the session when logging in through `/api/admin/login`, preventing proper authentication passthrough to the Tiles API.

## Solution Applied

### 1. Fixed Admin Login Session Storage
Updated `/src/server/controllers/campaign-crud.js` to store the password in the session:

```javascript
req.session.admin.superAdmin = {
    id: user._id,
    username: user.username,
    password: password, // Now storing raw password for Tiles API authentication
    email: user.email
};
```

### 2. Create Super Admin User
Run the script to create a super-admin user:

```bash
cd /home/tharles/projects_lapig/tvi/src/server
node scripts/create-super-admin.js
```

This creates a user with:
- Username: `admin`
- Password: `admin123`
- Role: `super-admin`

## Usage

### 1. Login as Admin
First, login as admin through the campaign admin interface:

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

### 2. Access Cache Manager
After logging in, the cache manager will automatically use the session credentials to authenticate with the Tiles API.

## Security Notes
- **Change the default password** in production environments
- The password is stored in the session to enable API-to-API authentication
- Consider using environment variables for production credentials

## Tiles API Configuration
The Tiles API URL is configured in `/src/server/config.js`:

```javascript
tilesApi: {
    baseUrl: process.env.TILES_API_URL || "http://0.0.0.0:8080",
    // ... other endpoints
}
```

Set the `TILES_API_URL` environment variable if the Tiles API is running on a different host/port.

## Troubleshooting

### Check if super-admin exists
```bash
mongo tvi --eval "db.users.find({role: 'super-admin'}).pretty()"
```

### Update super-admin password
```bash
mongo tvi --eval "db.users.update({role: 'super-admin'}, {\$set: {password: 'newpassword'}})"
```

### Verify Tiles API connectivity
```bash
# Test with Basic auth
curl -u admin:admin123 http://0.0.0.0:8080/api/cache/stats
```