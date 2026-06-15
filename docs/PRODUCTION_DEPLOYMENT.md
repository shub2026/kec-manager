# 生产环境部署检查清单

## 📋 部署前准备

### 1. 服务器要求
- [ ] Node.js 18.x 或更高版本
- [ ] npm 8.x 或更高版本
- [ ] 至少 2GB 可用内存
- [ ] 防火墙开放端口 3000（后端）和 Nginx 端口 80/443

### 2. 数据库准备

#### 方案 A：SQLite（小型部署，< 1000 用户）
```bash
# 创建数据目录
mkdir -p /var/www/kec-manager/server/data

# 设置权限
chown -R www-data:www-data /var/www/kec-manager/server/data
chmod 755 /var/www/kec-manager/server/data
```

#### 方案 B：MySQL（推荐，> 1000 用户）
```sql
-- 创建数据库和用户
CREATE DATABASE kec_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kec_user'@'localhost' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON kec_manager.* TO 'kec_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3. 环境变量配置

**⚠️ 重要：不要使用示例中的密钥！**

```bash
cd /var/www/kec-manager/server

# 生成安全的 JWT 密钥
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_DOWNLOAD_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# 复制生成的密钥到 .env 文件
cp .env.production.example .env
vim .env  # 编辑配置文件
```

**.env 文件关键配置：**
```bash
NODE_ENV=production

# SQLite 方式
DATABASE_URL="file:/var/www/kec-manager/server/data/kec.db"

# MySQL 方式（推荐）
# DATABASE_URL="mysql://kec_user:password@localhost:3306/kec_manager"

PORT=3000

# 使用上面生成的密钥
JWT_SECRET=your_128_char_hex_string
JWT_REFRESH_SECRET=your_128_char_hex_string
JWT_DOWNLOAD_SECRET=your_128_char_hex_string

# 包含生产域名
CORS_ORIGINS=https://kec.sntip.cn,https://www.kec.sntip.cn

LOG_LEVEL=info
```

## 🚀 部署步骤

### 1. 克隆代码
```bash
cd /var/www
git clone https://gitee.com/shub77/kec-manager.git
cd kec-manager
```

### 2. 安装依赖
```bash
# 根目录
npm install

# 后端
cd server
npm install --production

# 前端
cd ../client
npm install
```

### 3. 初始化数据库
```bash
cd /var/www/kec-manager/server

# 执行迁移
npx prisma migrate deploy

# 生成 Prisma Client
npx prisma generate

# 初始化管理员账号
npm run db:seed
```

### 4. 构建前端
```bash
cd /var/www/kec-manager/client
npm run build

# 复制到 Nginx 目录
sudo cp -r dist/* /var/www/html/kec-manager/
```

### 5. 启动后端服务
```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start src/server.js --name kec-server

# 设置开机自启
pm2 save
pm2 startup

# 查看状态
pm2 status
pm2 logs kec-server
```

### 6. 配置 Nginx
```nginx
server {
    listen 80;
    server_name kec.sntip.cn;
    
    # HTTPS 重定向（可选但推荐）
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name kec.sntip.cn;
    
    # SSL 证书配置
    ssl_certificate /etc/letsencrypt/live/kec.sntip.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kec.sntip.cn/privkey.pem;
    
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # 前端静态文件
    root /var/www/html/kec-manager;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 7. 测试部署
```bash
# 健康检查
curl http://localhost:3000/api/health

# 测试设置接口
curl http://localhost:3000/api/settings

# 外部访问测试
curl https://kec.sntip.cn/api/health
```

## 🔍 故障排查

### 问题 1：500 Internal Server Error
```bash
# 检查日志
pm2 logs kec-server --lines 100

# 常见原因：
# - 数据库连接失败
# - Prisma Client 未生成
# - 数据库表不存在
```

**解决方案：**
```bash
cd /var/www/kec-manager/server
npx prisma generate
npx prisma migrate deploy
pm2 restart kec-server
```

### 问题 2：CORS 错误
```bash
# 检查 .env 中的 CORS_ORIGINS 是否包含前端域名
cat .env | grep CORS_ORIGINS

# 修改后重启
pm2 restart kec-server
```

### 问题 3：数据库锁定（SQLite）
```bash
# 检查文件权限
ls -la data/kec.db

# 修复权限
chown www-data:www-data data/kec.db
chmod 644 data/kec.db
```

### 问题 4：JWT 认证失败
```bash
# 检查 JWT_SECRET 长度和格式（应该是纯十六进制，至少32字符）
echo $JWT_SECRET | wc -c
echo $JWT_SECRET | grep -E '^[a-f0-9]+$'
```

## 📊 监控和维护

### 日志管理
```bash
# 查看实时日志
pm2 logs kec-server

# 查看错误日志
pm2 logs kec-server --err

# 日志轮转配置（/etc/logrotate.d/kec-server）
/var/www/kec-manager/server/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 www-data www-data
}
```

### 备份策略
```bash
#!/bin/bash
# backup.sh - 每日备份脚本

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/kec-manager"

mkdir -p $BACKUP_DIR

# SQLite 备份
cp /var/www/kec-manager/server/data/kec.db $BACKUP_DIR/kec_$DATE.db

# MySQL 备份
# mysqldump -u kec_user -p kec_manager > $BACKUP_DIR/kec_$DATE.sql

# 保留最近30天的备份
find $BACKUP_DIR -name "*.db" -mtime +30 -delete

echo "Backup completed: kec_$DATE.db"
```

### 更新部署
```bash
cd /var/www/kec-manager

# 拉取最新代码
git pull

# 安装新依赖
cd server && npm install --production
cd ../client && npm install

# 数据库迁移
cd server && npx prisma migrate deploy && npx prisma generate

# 重新构建前端
cd ../client && npm run build
sudo cp -r dist/* /var/www/html/kec-manager/

# 重启服务
pm2 restart kec-server
```

## ✅ 部署检查清单

- [ ] Node.js 版本 >= 18
- [ ] 数据库已创建并配置正确
- [ ] `.env` 文件已配置（不使用默认密钥）
- [ ] `npx prisma generate` 已执行
- [ ] `npx prisma migrate deploy` 已执行
- [ ] 管理员账号已创建
- [ ] 前端已构建并部署到 Nginx
- [ ] Nginx 配置正确（包含 API 代理）
- [ ] CORS 配置包含生产域名
- [ ] PM2 进程正常运行
- [ ] 健康检查接口返回正常
- [ ] HTTPS 证书已配置（推荐）
- [ ] 备份脚本已设置
- [ ] 日志轮转已配置

## 🆘 获取帮助

如果遇到问题：
1. 检查 PM2 日志：`pm2 logs kec-server`
2. 检查 Nginx 日志：`tail -f /var/log/nginx/error.log`
3. 查看项目 Issues：https://gitee.com/shub77/kec-manager/issues
4. 提交新的 Issue 并附上错误日志
