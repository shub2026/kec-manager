# 登录指南

## 默认管理员账号

数据库重置后,系统会自动创建默认的管理员账号。

### 登录信息

- **用户名**: `admin`
- **密码**: `admin@123456`
- **角色**: 超级管理员 (super_admin)

### 访问地址

- **前端**: http://localhost:5181 (端口可能因占用而变化,请查看终端输出)
- **后端API**: http://localhost:3000

### 注意事项

1. ⚠️ **生产环境首次登录后请立即修改密码**
2. 如果忘记密码,可以执行以下命令重置数据库:
   ```bash
   cd server
   powershell -Command "$env:FORCE_RESET='true'; node prisma/seed.js"
   ```

### 常见问题

**Q: 登录提示"用户名或密码错误"?**

A: 请确认:
- 使用的是正确的密码 `admin@123456`(不是 `123456`)
- 数据库已正确初始化(执行过种子数据脚本)
- 后端服务正在运行

**Q: 如何重置所有数据?**

A: 执行数据库重置命令会清空所有数据并重新创建admin账号:
```bash
cd server
powershell -Command "$env:FORCE_RESET='true'; node prisma/seed.js"
```
