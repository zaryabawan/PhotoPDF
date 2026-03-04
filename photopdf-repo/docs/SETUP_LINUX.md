# Linux VPS Setup

Complete deployment guide for Ubuntu/Debian VPS with full root access.

## 1. Connect and update

```bash
ssh root@YOUR_VPS_IP
apt update && apt upgrade -y
```

## 2. Create user

```bash
adduser photopdf
usermod -aG sudo photopdf
su - photopdf
```

## 3. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should show v20.x.x
```

## 4. Clone repo and set up

```bash
git clone https://github.com/yourusername/photopdf.git
cd photopdf/server
node scripts/init.js
```

## 5. Install PM2

```bash
sudo npm install -g pm2
pm2 start server.js --name photopdf-license
pm2 startup
# Run the command it prints, then:
pm2 save
```

## 6. Install Nginx

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/photopdf
```

Paste:

```nginx
server {
    listen 80;
    server_name license.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/photopdf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 7. SSL certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d license.yourdomain.com
```

## 8. Update client HTML

```javascript
const SERVER_URL = 'https://license.yourdomain.com';
```

## Daily commands

```bash
pm2 status                              # Check server status
pm2 logs photopdf-license              # View logs
pm2 restart photopdf-license           # Restart after changes
node scripts/admin.js status           # Key summary
node scripts/admin.js list-used        # See activated keys
node scripts/admin.js revoke --key=XX  # Revoke a key
node scripts/admin.js backup           # Backup database
```
