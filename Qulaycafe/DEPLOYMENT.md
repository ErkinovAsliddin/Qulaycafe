# Prime Restaurant App - Deployment Guide (Hostinger & AWS)

This application is built with React 19, TypeScript, Tailwind CSS v4, Express, and Vite. It can be deployed either as a **Full-Stack Node.js App** (with real-time SSE syncing, API endpoints, and Google OAuth) or as a **Static Client-Side SPA**.

---

## 🚀 Option 1: Full-Stack Deployment (Hostinger VPS or AWS EC2 / App Runner)

This is the recommended deployment mode to preserve all real-time order notifications, kitchen display updates, inventory tracking, and backend API endpoints.

### 1. Deploying on Hostinger VPS (Docker or Node.js)
1. **Connect to your Hostinger VPS** via SSH:
   ```bash
   ssh root@YOUR_HOSTINGER_VPS_IP
   ```
2. **Clone your repository** or upload project files.
3. **Using Docker (Easiest)**:
   ```bash
   docker build -t prime-restaurant-app .
   docker run -d -p 80:3000 --name prime-app -e NODE_ENV=production prime-restaurant-app
   ```
4. **Without Docker (PM2 & Nginx)**:
   ```bash
   npm install
   npm run build
   npm install -g pm2
   pm2 start npm --name "prime-app" -- start
   ```

### 2. Deploying on AWS EC2 / AWS Elastic Beanstalk / AWS App Runner
1. **AWS App Runner / ECS (Containerized)**:
   - Push the Docker image to AWS ECR.
   - Create a service in AWS App Runner mapping container port `3000` to HTTP port `80/443`.
2. **AWS EC2 (Ubuntu Linux)**:
   - Launch an EC2 instance (t3.micro or t3.small).
   - Install Node.js 20 and PM2.
   - Run `npm run build` followed by `pm2 start npm --name "prime-restaurant" -- start`.
   - Set up an AWS Security Group opening Ports `80`, `443`, and `3000`.

---

## 🌐 Option 2: Static SPA Deployment (Hostinger Shared Hosting or AWS S3 + CloudFront)

If hosting on Hostinger Shared Web Hosting or AWS S3 static website hosting:

1. **Build the production static assets**:
   ```bash
   npm run build
   ```
2. Locate the output directory `/dist`.
3. **Hostinger Shared Hosting**:
   - Open Hostinger hPanel -> File Manager -> `public_html`.
   - Upload all files inside the generated `dist/` folder directly into `public_html/`.
   - Add a `.htaccess` file in `public_html` for single-page app routing:
     ```apache
     <IfModule mod_rewrite.c>
       RewriteEngine On
       RewriteBase /
       RewriteRule ^index\.html$ - [L]
       RewriteCond %{REQUEST_FILENAME} !-f
       RewriteCond %{REQUEST_FILENAME} !-d
       RewriteRule . /index.html [L]
     </IfModule>
     ```
4. **AWS S3 + CloudFront**:
   - Upload the contents of `dist/` to an S3 Bucket.
   - Enable Static Website Hosting with `index.html` as the Error & Index document.
   - Connect CloudFront CDN for global HTTPS SSL caching.

---

## 🔑 Environment Variables
Configure these variables in your hosting panel (Hostinger environment manager or AWS Parameter Store/App Runner settings):

- `NODE_ENV`: `production`
- `PORT`: `3000` (or as assigned by host)
- `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID for Gmail sign-in.
- `GEMINI_API_KEY`: Your Gemini API key if AI assistance is enabled.
