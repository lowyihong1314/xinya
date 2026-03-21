import smtplib
from email.message import EmailMessage
from _token import GMAIL_APP_PASSWORD

# ===== 配置区域 =====
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

GMAIL_USER = "lowyihong1314@gmail.com"       # 你的 Gmail

FROM_EMAIL = "yukang@utbabuddha.com"      # 域名邮箱
TO_EMAIL = "lowkeyin1234@gmail.com"         # 测试收件人（可以是自己）

msg = EmailMessage()
msg["Subject"] = "UTBABUDDHA SMTP 测试邮件"
msg["From"] = FROM_EMAIL
msg["To"] = TO_EMAIL
msg.set_content(
    "如果你收到这封邮件，说明：\n"
    "Cloudflare + Gmail SMTP 配置成功 ✅\n\n"
    "— yukang"
)

# ===== 发送 =====
with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
    server.ehlo()
    server.starttls()
    server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    server.send_message(msg)

print("✅ 邮件发送成功")
