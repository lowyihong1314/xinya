# ERP 邮件系统架构文档

**项目名称**：ERP Mail System  
**版本**：v1.0  
**最后更新**：2026-07-12  

---

## 📋 目录

1. [系统概述](#系统概述)
2. [架构设计](#架构设计)
3. [技术栈](#技术栈)
4. [工作流程](#工作流程)
5. [数据库设计](#数据库设计)
6. [API文档](#api文档)
7. [前端实现](#前端实现)
8. [后端实现](#后端实现)
9. [配置指南](#配置指南)
10. [部署说明](#部署说明)

---

## 系统概述

### 功能定义

**ERP邮件系统** 是一个集成在ERP中的完整邮件解决方案，允许员工使用公司邮箱 `{username}@utba.my` 在ERP中直接发送和接收邮件。

### 核心特性

| 特性 | 说明 |
|------|------|
| **多账户发送** | 支持50-100+个员工邮箱，员工可自由切换 |
| **自动化配置** | 新员工入职时自动创建邮箱和转发规则 |
| **灵活转发** | 员工可随时修改邮箱转发地址 |
| **邮件日志** | 所有发送邮件记录在ERP中 |
| **零维护** | 无需运维SMTP服务器 |
| **低成本** | 仅需付费Resend费用（低流量基本免费） |

### 目标用户

- **HR/管理员**：管理员工邮箱配置
- **普通员工**：在ERP中发送/接收公司邮件
- **系统管理员**：部署和维护系统

---

## 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      ERP系统前端                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ 邮件模块 ────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │  • 新建邮件（富文本编辑器）                          │  │
│  │  • 已发送邮件列表                                   │  │
│  │  • 邮件设置（配置转发地址）                         │  │
│  │  • 邮件日志查询                                     │  │
│  │                                                       │  │
│  └───────────┬───────────────────────────────────────────┘  │
│              │                                               │
└──────────────┼───────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    ERP后端服务                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  /api/send-email (POST)                                    │
│  /api/user/email-settings (GET)                            │
│  /api/user/email-settings/update-forwarding (POST)         │
│  /api/employees/:id/onboard (POST)                         │
│  /api/user/profile (GET)                                   │
│                                                              │
└──────┬──────────────────────────┬─────────────────┬────────┘
       │                          │                 │
       ▼                          ▼                 ▼
   ┌──────────┐         ┌─────────────────┐   ┌──────────────┐
   │ Resend   │         │  Cloudflare     │   │  PostgreSQL  │
   │  API     │         │   Mail Routing  │   │  Database    │
   │(发邮件) │         │  & Email API    │   │  (数据存储) │
   │          │         │  (转发邮件)     │   │              │
   └────┬─────┘         └────────┬────────┘   └──────────────┘
        │                       │
        │                       │
        ▼                       ▼
   john@utba.my ─────────────→ Cloudflare ─────→ john@gmail.com
   (发送方)                   (自动转发)        (收件方)
        ↓
   收件人邮箱
```

### 信息流

```
【发邮件流程】
员工在ERP选择收件人
    ↓
点击"发送"
    ↓
ERP前端调用 POST /api/send-email
    ↓
后端获取当前登录员工信息
    ↓
调用 Resend API 发送
    ↓
记录邮件日志到数据库
    ↓
返回成功响应


【收邮件流程】
外部发送者 → john@utba.my
    ↓
Cloudflare检测到该邮箱转发规则
    ↓
自动转发到 john@gmail.com
    ↓
员工在Gmail中查看邮件


【配置转发流程】
员工登录ERP
    ↓
进入"邮件设置"
    ↓
输入新的转发邮箱地址
    ↓
点击"保存"
    ↓
ERP后端调用 Cloudflare API
    ↓
删除旧规则 + 创建新规则
    ↓
数据库更新转发地址
    ↓
成功提示


【员工入职流程】
HR创建新员工账户
    ↓
输入员工个人邮箱（如：john@gmail.com）
    ↓
点击"批准入职"
    ↓
后端自动调用 Cloudflare API 创建规则
    ↓
数据库记录员工邮箱配置
    ↓
员工收到欢迎邮件
    ↓
员工可以在ERP使用公司邮箱
```

---

## 技术栈

### 前端
| 技术 | 用途 |
|------|------|
| HTML5 | 页面结构 |
| CSS3 | 样式设计 |
| JavaScript (ES6+) | 交互逻辑 |
| Fetch API | HTTP请求 |
| ContentEditable | 富文本编辑 |

### 后端
| 技术 | 用途 |
|------|------|
| Node.js / Express | Web框架 |
| PostgreSQL | 数据库 |
| Resend SDK | 邮件发送 |
| Axios | HTTP客户端（调用Cloudflare API） |
| JWT | 用户认证 |
| bcrypt | 密码加密 |

### 第三方服务
| 服务 | 功能 | 费用 |
|------|------|------|
| **Resend** | 发送邮件 | 免费 + $0.1/100封 |
| **Cloudflare** | 邮件路由、DNS | 免费（邮件路由） |
| **PostgreSQL** | 数据存储 | 自建或云服务 |

### 环境要求
```
Node.js: v16 或更高版本
npm: v8 或更高版本
PostgreSQL: v12 或更高版本
```

---

## 工作流程

### 1. 新员工入职流程

```
步骤 1️⃣: HR在ERP中创建新员工
  输入信息:
  - 用户名: john_doe
  - 姓名: John Doe
  - 个人邮箱: john@gmail.com

步骤 2️⃣: HR点击"批准入职"
  系统自动执行:
  - 在数据库中创建员工记录
  - 调用Cloudflare API创建转发规则
  - john@utba.my → john@gmail.com
  - 保存Cloudflare规则ID

步骤 3️⃣: 系统发送欢迎邮件
  内容:
  - 公司邮箱: john@utba.my
  - 使用说明

步骤 4️⃣: 员工登录ERP
  立即可用:
  - 可以发送邮件
  - 可以配置转发地址
```

### 2. 发送邮件流程

```
步骤 1️⃣: 员工在ERP中新建邮件
  操作:
  - 点击"新建邮件"
  - 输入收件人、主题、内容
  - 点击"发送"

步骤 2️⃣: 前端验证
  检查:
  - 收件人邮箱格式
  - 主题非空
  - 内容非空

步骤 3️⃣: 调用后端API
  POST /api/send-email
  请求体:
  {
    "toEmail": "recipient@example.com",
    "subject": "Meeting Reminder",
    "body": "<p>Please attend...</p>"
  }

步骤 4️⃣: 后端处理
  - 验证用户身份（JWT）
  - 获取员工邮箱信息
  - 调用Resend API发送
  - 记录日志到数据库

步骤 5️⃣: Resend发送
  - 从john@utba.my发送
  - 使用Resend基础设施
  - 处理SPF/DKIM/DMARC认证

步骤 6️⃣: 返回结果
  响应:
  {
    "success": true,
    "messageId": "msg_xxxxx",
    "message": "邮件已发送"
  }

步骤 7️⃣: 前端显示
  - 显示发送成功提示
  - 清空表单
  - 更新已发送列表
```

### 3. 接收邮件流程

```
步骤 1️⃣: 外部发送者发邮件
  → recipient: john@utba.my

步骤 2️⃣: Cloudflare检测
  - 识别john@utba.my
  - 查找转发规则

步骤 3️⃣: 自动转发
  - john@utba.my → john@gmail.com
  - Cloudflare代理转发

步骤 4️⃣: 邮件到达Gmail
  - 员工在Gmail收件箱查看
  - 完全由Gmail管理

注意: ERP不需要读取Gmail邮件，员工自己在Gmail中管理收件
```

### 4. 修改转发地址流程

```
步骤 1️⃣: 员工进入ERP邮件设置
  
步骤 2️⃣: 输入新转发邮箱
  旧: john@gmail.com
  新: john.doe@outlook.com

步骤 3️⃣: 点击"保存"
  调用 POST /api/user/email-settings/update-forwarding

步骤 4️⃣: 后端处理
  - 从数据库获取旧规则ID
  - 调用Cloudflare API删除旧规则
  - 调用Cloudflare API创建新规则
  - 更新数据库中的转发地址和规则ID

步骤 5️⃣: 验证
  - 新规则立即生效
  - john@utba.my → john.doe@outlook.com

步骤 6️⃣: 确认消息
  显示: ✓ 已保存，转发地址：john.doe@outlook.com
```

---

## 数据库设计

### 员工表 (employees)

```sql
CREATE TABLE employees (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  company_email VARCHAR(100) UNIQUE NOT NULL,
  forwarding_address VARCHAR(100),
  cloudflare_rule_id VARCHAR(100),
  status ENUM('pending', 'active', 'inactive') DEFAULT 'pending',
  email_config_status ENUM('pending', 'configured', 'error') DEFAULT 'pending',
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_username (username),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);
```

**字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| username | VARCHAR | 员工用户名（john_doe） |
| name | VARCHAR | 员工姓名（John Doe） |
| company_email | VARCHAR | 公司邮箱（john@utba.my） |
| forwarding_address | VARCHAR | 转发地址（john@gmail.com） |
| cloudflare_rule_id | VARCHAR | Cloudflare规则ID |
| status | ENUM | 员工状态（待审批/活跃/停用） |
| email_config_status | ENUM | 邮箱配置状态 |
| password_hash | VARCHAR | 加密密码 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 邮件日志表 (email_logs)

```sql
CREATE TABLE email_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  employee_id INT NOT NULL,
  from_email VARCHAR(100) NOT NULL,
  to_email VARCHAR(100) NOT NULL,
  subject VARCHAR(255),
  body LONGTEXT,
  direction ENUM('sent', 'received') NOT NULL,
  status ENUM('success', 'failed', 'pending') DEFAULT 'pending',
  message_id VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_employee_id (employee_id),
  INDEX idx_direction (direction),
  INDEX idx_created_at (created_at),
  INDEX idx_status (status)
);
```

**字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| employee_id | INT | 员工ID（外键） |
| from_email | VARCHAR | 发件人邮箱 |
| to_email | VARCHAR | 收件人邮箱 |
| subject | VARCHAR | 邮件主题 |
| body | LONGTEXT | 邮件内容（HTML） |
| direction | ENUM | 方向（发送/接收） |
| status | ENUM | 状态（成功/失败/待处理） |
| message_id | VARCHAR | Resend返回的消息ID |
| error_message | TEXT | 错误信息 |
| created_at | TIMESTAMP | 创建时间 |

### 审批日志表 (approval_logs)

```sql
CREATE TABLE approval_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  employee_id INT NOT NULL,
  approver_id INT NOT NULL,
  action ENUM('approved', 'rejected') NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id) REFERENCES employees(id),
  INDEX idx_employee_id (employee_id),
  INDEX idx_action (action)
);
```

---

## API文档

### 1. 获取用户信息

**请求**
```
GET /api/user/profile
Authorization: Bearer {token}
```

**响应 (200)**
```json
{
  "id": 1,
  "username": "john_doe",
  "name": "John Doe",
  "companyEmail": "john@utba.my"
}
```

---

### 2. 发送邮件

**请求**
```
POST /api/send-email
Authorization: Bearer {token}
Content-Type: application/json

{
  "toEmail": "recipient@example.com",
  "subject": "Meeting Reminder",
  "body": "<p>Please attend the meeting...</p>",
  "ccEmail": "optional@example.com",
  "bccEmail": "optional2@example.com"
}
```

**响应 (200)**
```json
{
  "success": true,
  "messageId": "msg_xxxxxxxxxxxxx",
  "message": "邮件已发送"
}
```

**响应 (400)**
```json
{
  "success": false,
  "error": "缺少必填字段"
}
```

**响应 (500)**
```json
{
  "success": false,
  "error": "邮件发送失败：原因描述"
}
```

---

### 3. 获取邮件设置

**请求**
```
GET /api/user/email-settings
Authorization: Bearer {token}
```

**响应 (200)**
```json
{
  "username": "john_doe",
  "companyEmail": "john@utba.my",
  "forwardingAddress": "john@gmail.com"
}
```

---

### 4. 更新转发地址

**请求**
```
POST /api/user/email-settings/update-forwarding
Authorization: Bearer {token}
Content-Type: application/json

{
  "forwardingAddress": "john.doe@outlook.com"
}
```

**响应 (200)**
```json
{
  "success": true,
  "message": "已配置转发：john@utba.my → john.doe@outlook.com"
}
```

**响应 (400)**
```json
{
  "success": false,
  "error": "请输入有效的邮箱地址"
}
```

**响应 (500)**
```json
{
  "success": false,
  "error": "转发配置失败：原因描述"
}
```

---

### 5. 员工入职审批

**请求**
```
POST /api/employees/:id/onboard
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "employeeId": 1,
  "personalEmail": "john@gmail.com"
}
```

**响应 (200)**
```json
{
  "success": true,
  "message": "员工已入职，邮箱转发已配置：john@utba.my → john@gmail.com"
}
```

**响应 (500)**
```json
{
  "success": false,
  "error": "配置失败：原因描述"
}
```

---

### 6. 查询邮件日志

**请求**
```
GET /api/emails/logs?page=1&limit=20&direction=sent
Authorization: Bearer {token}
```

**响应 (200)**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "fromEmail": "john@utba.my",
      "toEmail": "recipient@example.com",
      "subject": "Meeting Reminder",
      "direction": "sent",
      "status": "success",
      "sentAt": "2024-07-12T10:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

## 前端实现

### 1. 邮件发送界面

**文件**: `src/components/EmailCompose.html`

```html
<div class="email-compose">
  <h2>新建邮件</h2>
  
  <div class="compose-header">
    <div class="header-row">
      <label>发件人：</label>
      <span id="senderEmail">john@utba.my</span>
    </div>
    
    <div class="header-row">
      <label>收件人：</label>
      <input type="email" id="toEmail" placeholder="请输入收件人邮箱" required>
    </div>
    
    <div class="header-row">
      <label>主题：</label>
      <input type="text" id="subject" placeholder="请输入邮件主题" required>
    </div>
  </div>
  
  <div class="toolbar">
    <button class="tool-btn" onclick="formatBold()" title="粗体"><strong>B</strong></button>
    <button class="tool-btn" onclick="formatItalic()" title="斜体"><em>I</em></button>
    <button class="tool-btn" onclick="formatUnderline()" title="下划线"><u>U</u></button>
  </div>
  
  <div class="editor">
    <div id="bodyEditor" contenteditable="true" class="rich-editor" 
         placeholder="请输入邮件内容..."></div>
  </div>
  
  <div class="compose-footer">
    <button class="btn-send" onclick="sendEmail()">发送邮件</button>
    <button class="btn-cancel" onclick="closeCompose()">关闭</button>
  </div>
  
  <div id="message" class="message"></div>
</div>

<script>
  async function sendEmail() {
    const toEmail = document.getElementById('toEmail').value;
    const subject = document.getElementById('subject').value;
    const body = document.getElementById('bodyEditor').innerHTML;
    
    if (!toEmail || !subject || !body) {
      showMessage('error', '请填写所有必填字段');
      return;
    }
    
    showMessage('', '发送中...');
    
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          toEmail: toEmail,
          subject: subject,
          body: body
        })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        showMessage('success', '✓ 邮件已成功发送');
        resetForm();
        setTimeout(() => closeCompose(), 2000);
      } else {
        showMessage('error', `✗ 发送失败：${result.error}`);
      }
    } catch (err) {
      showMessage('error', `✗ 网络错误：${err.message}`);
    }
  }
  
  function showMessage(type, text) {
    const msgDiv = document.getElementById('message');
    msgDiv.className = type ? `message ${type}` : 'message';
    msgDiv.textContent = text;
  }
</script>
```

### 2. 邮件设置界面

**文件**: `src/components/EmailSettings.html`

```html
<div class="email-settings">
  <h2>邮件设置</h2>
  
  <div class="settings-content">
    <div class="setting-group">
      <label>公司邮箱：</label>
      <span id="companyEmail" class="email-display">john@utba.my</span>
    </div>
    
    <div class="setting-group">
      <label>转发地址：</label>
      <div class="input-group">
        <input type="email" id="forwardingAddress" placeholder="例：john@gmail.com">
        <button class="btn-save" onclick="updateForwarding()">保存</button>
      </div>
    </div>
    
    <div id="statusMessage" class="message"></div>
  </div>
</div>

<script>
  // 加载当前设置
  async function loadSettings() {
    const response = await fetch('/api/user/email-settings', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    const data = await response.json();
    document.getElementById('companyEmail').textContent = data.companyEmail;
    document.getElementById('forwardingAddress').value = data.forwardingAddress || '';
  }
  
  // 更新转发地址
  async function updateForwarding() {
    const newAddress = document.getElementById('forwardingAddress').value;
    
    if (!newAddress.includes('@')) {
      showStatus('error', '请输入有效的邮箱地址');
      return;
    }
    
    showStatus('', '保存中...');
    
    try {
      const response = await fetch('/api/user/email-settings/update-forwarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ forwardingAddress: newAddress })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        showStatus('success', `✓ ${result.message}`);
      } else {
        showStatus('error', `✗ ${result.error}`);
      }
    } catch (err) {
      showStatus('error', `✗ 网络错误：${err.message}`);
    }
  }
  
  function showStatus(type, text) {
    const msgDiv = document.getElementById('statusMessage');
    msgDiv.className = type ? `message ${type}` : 'message';
    msgDiv.textContent = text;
  }
  
  // 页面加载时获取设置
  document.addEventListener('DOMContentLoaded', loadSettings);
</script>
```

---

## 后端实现

### 1. 初始化项目

```bash
npm init -y
npm install express pg axios dotenv bcrypt jsonwebtoken
```

### 2. 环境配置文件

**文件**: `.env`

```env
# 服务器配置
PORT=3000
NODE_ENV=development

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=erp_mail

# JWT配置
JWT_SECRET=your_secret_key_here
JWT_EXPIRY=7d

# Resend配置
RESEND_API_KEY=re_xxxxxxxxxxxxx

# Cloudflare配置
CLOUDFLARE_API_TOKEN=your_cloudflare_token
CLOUDFLARE_ZONE_ID=your_zone_id

# 域名配置
DOMAIN=utba.my
```

### 3. 数据库连接

**文件**: `src/db.js`

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

pool.on('error', (err) => {
  console.error('数据库连接错误:', err);
});

module.exports = pool;
```

### 4. 邮件服务

**文件**: `src/services/emailService.js`

```javascript
const { Resend } = require('resend');
const db = require('../db');

const resend = new Resend(process.env.RESEND_API_KEY);

class EmailService {
  // 发送邮件
  static async sendEmail(employeeId, toEmail, subject, body, ccEmail, bccEmail) {
    try {
      // 获取员工信息
      const employee = await db.query(
        'SELECT username, name FROM employees WHERE id = $1',
        [employeeId]
      );
      
      if (employee.rows.length === 0) {
        throw new Error('员工不存在');
      }
      
      const emp = employee.rows[0];
      const fromEmail = `${emp.username}@${process.env.DOMAIN}`;
      
      // 调用Resend API
      const result = await resend.emails.send({
        from: `"${emp.name}" <${fromEmail}>`,
        to: toEmail,
        cc: ccEmail || undefined,
        bcc: bccEmail || undefined,
        subject: subject,
        html: body
      });
      
      // 记录日志
      await db.query(
        'INSERT INTO email_logs (employee_id, from_email, to_email, subject, direction, status, message_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [employeeId, fromEmail, toEmail, subject, 'sent', 'success', result.id]
      );
      
      return {
        success: true,
        messageId: result.id,
        message: '邮件已发送'
      };
    } catch (err) {
      // 记录失败日志
      await db.query(
        'INSERT INTO email_logs (employee_id, from_email, to_email, subject, direction, status, error_message) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [employeeId, 'unknown', toEmail, subject, 'sent', 'failed', err.message]
      );
      
      throw err;
    }
  }
}

module.exports = EmailService;
```

### 5. Cloudflare服务

**文件**: `src/services/cloudflareService.js`

```javascript
const axios = require('axios');

class CloudflareService {
  static async createRoute(username, forwardingEmail) {
    try {
      const response = await axios.post(
        `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/email/routing/rules`,
        {
          matchers: [
            {
              type: 'literal',
              field: 'to',
              value: `${username}@${process.env.DOMAIN}`
            }
          ],
          actions: [
            {
              type: 'forward',
              value: [forwardingEmail]
            }
          ],
          enabled: true,
          priority: 1
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data.success) {
        return response.data.result.id;
      } else {
        throw new Error(response.data.errors[0].message);
      }
    } catch (err) {
      throw new Error(`Cloudflare配置失败: ${err.message}`);
    }
  }
  
  static async deleteRoute(ruleId) {
    try {
      await axios.delete(
        `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/email/routing/rules/${ruleId}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return true;
    } catch (err) {
      throw new Error(`删除Cloudflare规则失败: ${err.message}`);
    }
  }
}

module.exports = CloudflareService;
```

### 6. 路由处理

**文件**: `src/routes/emailRoutes.js`

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const EmailService = require('../services/emailService');
const CloudflareService = require('../services/cloudflareService');
const { authenticateToken } = require('../middleware/auth');

// 获取用户信息
router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, name FROM employees WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      companyEmail: `${user.username}@${process.env.DOMAIN}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 发送邮件
router.post('/send-email', authenticateToken, async (req, res) => {
  const { toEmail, subject, body, ccEmail, bccEmail } = req.body;
  
  if (!toEmail || !subject || !body) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  
  try {
    const result = await EmailService.sendEmail(
      req.user.id,
      toEmail,
      subject,
      body,
      ccEmail,
      bccEmail
    );
    
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: '邮件发送失败: ' + err.message
    });
  }
});

// 获取邮件设置
router.get('/user/email-settings', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT username, forwarding_address FROM employees WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    const emp = result.rows[0];
    res.json({
      username: emp.username,
      companyEmail: `${emp.username}@${process.env.DOMAIN}`,
      forwardingAddress: emp.forwarding_address
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新转发地址
router.post('/user/email-settings/update-forwarding', authenticateToken, async (req, res) => {
  const { forwardingAddress } = req.body;
  
  if (!forwardingAddress || !forwardingAddress.includes('@')) {
    return res.status(400).json({ error: '请输入有效的邮箱地址' });
  }
  
  try {
    // 获取当前规则ID
    const current = await db.query(
      'SELECT cloudflare_rule_id, username FROM employees WHERE id = $1',
      [req.user.id]
    );
    
    const emp = current.rows[0];
    
    // 删除旧规则
    if (emp.cloudflare_rule_id) {
      await CloudflareService.deleteRoute(emp.cloudflare_rule_id);
    }
    
    // 创建新规则
    const newRuleId = await CloudflareService.createRoute(
      emp.username,
      forwardingAddress
    );
    
    // 更新数据库
    await db.query(
      'UPDATE employees SET forwarding_address = $1, cloudflare_rule_id = $2 WHERE id = $3',
      [forwardingAddress, newRuleId, req.user.id]
    );
    
    res.json({
      success: true,
      message: `已配置转发：${emp.username}@${process.env.DOMAIN} → ${forwardingAddress}`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: '转发配置失败: ' + err.message
    });
  }
});

// 员工入职
router.post('/employees/:id/onboard', authenticateToken, async (req, res) => {
  const { employeeId, personalEmail } = req.body;
  
  // 验证用户是HR/管理员
  const authCheck = await db.query(
    'SELECT role FROM employees WHERE id = $1',
    [req.user.id]
  );
  
  if (authCheck.rows[0].role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }
  
  try {
    // 获取员工信息
    const emp = await db.query(
      'SELECT username FROM employees WHERE id = $1',
      [employeeId]
    );
    
    if (emp.rows.length === 0) {
      return res.status(404).json({ error: '员工不存在' });
    }
    
    const username = emp.rows[0].username;
    
    // 创建Cloudflare规则
    const ruleId = await CloudflareService.createRoute(username, personalEmail);
    
    // 更新数据库
    await db.query(
      'UPDATE employees SET forwarding_address = $1, cloudflare_rule_id = $2, status = $3, email_config_status = $4 WHERE id = $5',
      [personalEmail, ruleId, 'active', 'configured', employeeId]
    );
    
    res.json({
      success: true,
      message: `员工已入职，邮箱转发已配置：${username}@${process.env.DOMAIN} → ${personalEmail}`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: '配置失败: ' + err.message
    });
  }
});

module.exports = router;
```

### 7. 认证中间件

**文件**: `src/middleware/auth.js`

```javascript
const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未提供令牌' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '令牌无效或过期' });
    }
    
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken };
```

### 8. 主服务器文件

**文件**: `src/server.js`

```javascript
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const emailRoutes = require('./routes/emailRoutes');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.use('/api', emailRoutes);

// 错误处理
app.use((err, req, res, next) => {
  console.error('错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
```

---

## 配置指南

### 1. Resend配置

**步骤1**: 访问 https://resend.com

**步骤2**: 注册账号

**步骤3**: 添加域名
- 进入 "Domains" → "Add Domain"
- 输入 `utba.my`
- 按照提示在Cloudflare DNS中添加验证记录

**步骤4**: 获取API Key
- 进入 "API Keys"
- 复制 API Key
- 添加到 `.env` 文件中的 `RESEND_API_KEY`

### 2. Cloudflare配置

**步骤1**: 访问 https://dash.cloudflare.com

**步骤2**: 选择域名 `utba.my`

**步骤3**: 启用邮件路由
- 进入 "Email Routing"
- 点击 "Enable"

**步骤4**: 获取API Token
- 进入 "My Profile" → "API Tokens"
- 创建新token
- 权限: Email Routing, Zone Settings
- 复制到 `.env` 中的 `CLOUDFLARE_API_TOKEN`

**步骤5**: 获取Zone ID
- 进入域名设置
- 右侧边栏找到 "Zone ID"
- 复制到 `.env` 中的 `CLOUDFLARE_ZONE_ID`

### 3. 数据库配置

```bash
# 创建数据库
createdb erp_mail

# 导入SQL脚本
psql erp_mail < schema.sql
```

**文件**: `schema.sql`

```sql
CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  company_email VARCHAR(100) UNIQUE NOT NULL,
  forwarding_address VARCHAR(100),
  cloudflare_rule_id VARCHAR(100),
  status ENUM('pending', 'active', 'inactive') DEFAULT 'pending',
  email_config_status ENUM('pending', 'configured', 'error') DEFAULT 'pending',
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE email_logs (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_email VARCHAR(100) NOT NULL,
  to_email VARCHAR(100) NOT NULL,
  subject VARCHAR(255),
  body TEXT,
  direction VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  message_id VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_email_logs_employee ON email_logs(employee_id);
CREATE INDEX idx_email_logs_created ON email_logs(created_at);
```

---

## 部署说明

### 生产环境部署

**步骤1**: 安装依赖
```bash
npm install
```

**步骤2**: 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，填入实际值
```

**步骤3**: 初始化数据库
```bash
psql erp_mail < schema.sql
```

**步骤4**: 启动服务
```bash
npm start
# 或使用PM2
pm2 start src/server.js --name erp-mail-server
```

**步骤5**: 验证服务
```bash
curl http://localhost:3000/api/user/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 使用Docker部署

**文件**: `Dockerfile`

```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/server.js"]
```

**文件**: `docker-compose.yml`

```yaml
version: '3.8'

services:
  erp-mail-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: postgres
      DB_PASSWORD: postgres
      DB_NAME: erp_mail
      JWT_SECRET: your-secret-key
      RESEND_API_KEY: your-resend-key
      CLOUDFLARE_API_TOKEN: your-cloudflare-token
      CLOUDFLARE_ZONE_ID: your-zone-id
    depends_on:
      - postgres

  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: erp_mail
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

启动:
```bash
docker-compose up -d
```

---

## 故障排除

### 问题1: 邮件发送失败

**错误信息**: "Resend API错误"

**排查步骤**:
1. 检查 `RESEND_API_KEY` 是否正确
2. 检查域名是否在Resend中已验证
3. 查看邮件日志：`SELECT * FROM email_logs WHERE status='failed' LIMIT 10;`

### 问题2: Cloudflare转发不工作

**错误信息**: "Cloudflare配置失败"

**排查步骤**:
1. 检查 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ZONE_ID`
2. 确认邮件路由已在Cloudflare中启用
3. 查看Cloudflare规则是否创建成功：https://dash.cloudflare.com → Email Routing

### 问题3: 数据库连接失败

**错误信息**: "连接数据库失败"

**排查步骤**:
1. 确认PostgreSQL服务运行中
2. 检查 `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`
3. 测试连接：`psql -U postgres -h localhost`

### 问题4: JWT认证失败

**错误信息**: "令牌无效或过期"

**排查步骤**:
1. 确认 `JWT_SECRET` 与发行token时使用的相同
2. 检查token是否过期（`JWT_EXPIRY`）
3. 从Authorization header中正确提取token

---

## 监控和日志

### 邮件发送统计

```sql
-- 今天发送的邮件数
SELECT COUNT(*) FROM email_logs 
WHERE direction='sent' 
AND created_at >= CURRENT_DATE;

-- 按员工统计发送量
SELECT 
  e.username, 
  COUNT(*) as count
FROM email_logs el
JOIN employees e ON el.employee_id = e.id
WHERE el.direction='sent'
GROUP BY e.username
ORDER BY count DESC;

-- 失败的邮件
SELECT 
  from_email, 
  to_email, 
  subject, 
  error_message
FROM email_logs
WHERE status='failed'
ORDER BY created_at DESC
LIMIT 10;
```

### 日志查看

```bash
# 实时查看服务器日志
pm2 logs erp-mail-server

# 查看错误日志
tail -f logs/error.log
```

---

## 安全建议

1. **生产环境**:
   - 使用HTTPS
   - 启用CORS限制
   - 定期更新依赖
   - 使用强密码和复杂密钥

2. **数据安全**:
   - 定期备份数据库
   - 邮件内容加密存储
   - 限制日志保留期限

3. **访问控制**:
   - 实施JWT令牌过期
   - 限制API速率
   - 监控异常活动

---

## 常见问题（FAQ）

**Q: 邮件转发地址可以改吗？**  
A: 可以。员工在"邮件设置"中随时修改，系统自动更新Cloudflare规则。

**Q: ERP需要读取Gmail邮件吗？**  
A: 不需要。员工在Gmail中管理收件，ERP只负责发送。

**Q: 离职员工怎么处理？**  
A: 管理员可删除员工，系统自动删除Cloudflare规则和邮箱配置。

**Q: 支持多少个员工？**  
A: 理论上无限制，成本随发送量增加。

**Q: 邮件会保留多久？**  
A: ERP中的发送日志根据策略设置（建议保留1年）。

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-12 | 初始版本发布 |

---

**文档维护者**: ERP Team  
**最后更新**: 2026-07-12  
**联系**: support@utba.my
