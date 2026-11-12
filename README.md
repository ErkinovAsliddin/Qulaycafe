[README.md](https://github.com/user-attachments/files/34737272/README.md)
<div align="center">

# 🍽️ Qulaycafe

### Multi-tenant QR ordering & restaurant management platform

**One codebase. Every restaurant gets its own branded ordering site, courier bot, and dashboard.**

[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)
[![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![Nginx](https://img.shields.io/badge/Nginx-009639?style=for-the-badge&logo=nginx&logoColor=white)](https://nginx.org)
[![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://core.telegram.org/bots)
[![AWS](https://img.shields.io/badge/AWS_EC2-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com/ec2/)

[Features](#-features) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [Deployment](#-deployment) · [Roadmap](#-roadmap) · [Author](#-author)

</div>

---

## 📖 Overview

**Qulaycafe** (formerly *PrimeWeb*) is a multi-tenant SaaS platform built for restaurants and cafés in Uzbekistan. A guest scans a QR code at the table, browses a branded menu, and places an order — dine-in, pickup, or delivery — with no app to install. The restaurant receives the order instantly, prints a kitchen ticket on a thermal printer, and dispatches couriers through Telegram.

Each restaurant (tenant) lives on its own slug URL — `yourdomain.com/<restaurant-slug>` — with its own menu, branding, staff, couriers, and analytics, all served from a single deployment.

> **Why it exists:** local restaurants need ordering software that works with the tools their customers and staff already use every day — Telegram, QR codes, and receipt printers — at a price a small business can sustain.

---

## ✨ Features

### For guests
- 📱 **QR ordering** — scan, browse, order. No download, no sign-up.
- 🧾 **Three order modes** — dine-in, pickup, and delivery.
- 🤖 **Telegram Mini App** — order from inside Telegram with a native feel.
- 🎨 **Branded experience** — each restaurant's colors, logo, and identity.

### For restaurants
- 🏪 **Multi-tenant by design** — isolated data and per-restaurant slug URLs.
- 🖨️ **ESC/POS thermal printing** — automatic kitchen and receipt tickets.
- 📊 **Analytics dashboard** — orders, revenue, and performance at a glance.
- 🎛️ **Branding customization** — configure the look of your storefront.
- 🔔 **Live order updates** — real-time delivery via Server-Sent Events (SSE).

### For couriers
- 🛵 **Telegram courier bots** — receive and manage deliveries in a chat.
- 🔀 **Multi-restaurant support** — a courier can serve more than one restaurant.

### For the platform owner
- 💳 **Subscription management** — monthly plans administered through a private Telegram bot.
- 🔒 **Subscription enforcement** — access is gated per tenant on the server side.

---

## 🏗️ Architecture

```
                    ┌────────────────────────────┐
                    │   Guest (QR / Mini App)    │
                    └─────────────┬──────────────┘
                                  │ HTTPS
                          ┌───────▼───────┐
                          │     Nginx     │  reverse proxy + SSL
                          └───────┬───────┘
                ┌─────────────────┼──────────────────┐
        ┌───────▼───────┐ ┌───────▼───────┐ ┌────────▼────────┐
        │ React SPA     │ │ Express API   │ │ Telegram Bots   │
        │ (storefront + │ │ REST + SSE    │ │ courier + admin │
        │  dashboard)   │ └───────┬───────┘ └────────┬────────┘
        └───────────────┘         │                  │
                            ┌─────▼──────────────────▼─────┐
                            │           SQLite             │
                            └──────────────────────────────┘
```

| Layer | Technology |
|---|---|
| Frontend | React (SPA) |
| Backend | Node.js + Express |
| Database | SQLite |
| Realtime | Server-Sent Events |
| Messaging | Telegram Bot API + Mini Apps |
| Printing | ESC/POS thermal printers |
| Infrastructure | Docker, docker-compose, Nginx, AWS EC2 |

### Multi-tenancy model

Every request resolves a tenant from the URL slug. All reads and writes — menus, orders, couriers, analytics, and live event streams — are scoped to that tenant, so one restaurant can never see another's data.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A Telegram bot token from [@BotFather](https://t.me/BotFather) (for courier / admin bots)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/ErkinovAsliddin/Qulaycafe.git
cd Qulaycafe

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# then edit .env with your values

# 4. Start in development
npm run dev
```

### Environment variables

| Variable | Description |
|---|---|
| `PORT` | API server port |
| `JWT_SECRET` | Secret used to sign auth tokens |
| `TELEGRAM_BOT_TOKEN` | Token for the platform / courier bot |
| `ADMIN_TELEGRAM_ID` | Telegram ID allowed to manage subscriptions |
| `DATABASE_PATH` | Path to the SQLite database file |

> ⚠️ Never commit your `.env` file or any secrets.

<!-- TODO: adjust the variable names and scripts above to match the actual repo. -->

---

## 🐳 Deployment

The platform ships as a containerized stack and is deployed on **AWS EC2** behind **Nginx** with SSL.

```bash
# Build and start all services
docker-compose up -d --build

# Follow logs
docker-compose logs -f
```

**Production checklist**

- [ ] Point your domain's DNS to the EC2 instance
- [ ] Issue an SSL certificate (e.g. Let's Encrypt / Certbot)
- [ ] Set production environment variables
- [ ] Mount a persistent volume for the SQLite database
- [ ] Schedule regular database backups

---

## 🔐 Security & Reliability

Built and hardened through real-world testing with live restaurants:

- Server-side **subscription enforcement** so lapsed tenants cannot bypass access
- **Tenant isolation** across REST endpoints and SSE streams
- Careful handling of **React state batching** to keep order flows consistent
- Robust **SPA routing** for deep links and QR-code entry points
- Correct **courier lookup** across multiple restaurants

---

## 🗺️ Roadmap

- [x] Multi-tenant slug routing
- [x] Dine-in, pickup, and delivery modes
- [x] Telegram courier bots and Mini App
- [x] ESC/POS thermal printing
- [x] Analytics dashboard
- [x] Telegram-based subscription management
- [ ] Complete AWS EC2 migration (Docker, Nginx, SSL)
- [ ] Online payment integration
- [ ] Multi-language storefront (Uzbek / Russian / English)
- [ ] Automated tests and CI/CD pipeline

---

## 📸 Screenshots

<!-- Add screenshots to /docs/screenshots and uncomment:

| Storefront | Dashboard | Courier Bot |
|---|---|---|
| ![Storefront](docs/screenshots/storefront.png) | ![Dashboard](docs/screenshots/dashboard.png) | ![Courier](docs/screenshots/courier.png) |

-->

---

## 🤝 Contributing

Suggestions and bug reports are welcome. Open an issue to discuss what you'd like to change, or submit a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push the branch: `git push origin feature/your-feature`
5. Open a pull request

---

## 📄 License

<!-- Choose a license (e.g. MIT) and add a LICENSE file. -->
All rights reserved unless a license file states otherwise.

---

## 👨‍💻 Author

**Asliddin Erkinov (Alex)** — independent full-stack developer based in Samarkand, Uzbekistan.

I build and ship web applications for local restaurants and businesses, and I'm open to freelance projects.

[![GitHub](https://img.shields.io/badge/GitHub-ErkinovAsliddin-181717?style=for-the-badge&logo=github)](https://github.com/ErkinovAsliddin)

<div align="center">

⭐ If you find this project useful, consider giving it a star.

</div>
