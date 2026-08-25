# cPanel Telegram Bot Installer

Installer + admin panel for a simple Telegram bot.

Features:
- Web installer at `/install/`
- Admin panel at `/admin`
- Change Bot Token and Chat ID
- Test Telegram connection
- Webhook endpoint
- Token stored outside `public`

## cPanel
Set the domain/subdomain document root to `cpanel-telegram-bot/public`.
Then open `/install/` and enter your Bot Token, Chat ID, and admin password.

After installation, remove or protect the `install` directory.

Do not put Telegram Bot Tokens or banking credentials in this repository.