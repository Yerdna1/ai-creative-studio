# Deployment Guide - AI Creative Studio

## Quick Deploy to Vercel

### Step 1: Connect GitHub to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository: `Yerdna1/ai-creative-studio`
4. Vercel will auto-detect Vite configuration

### Step 2: Configure Environment Variables

Add these in Vercel Project Settings > Environment Variables:

```
DATABASE_URL=your_neon_connection_string_here
SEEDANCE_API_KEY=your_seedance_key_here
AI_PROVIDER_API_KEY=your_ai_provider_key_here
```

### Step 3: Deploy

Click "Deploy" - Vercel will automatically:
- Build the project (`npm run build`)
- Deploy to global CDN
- Provide HTTPS URL

## Alternative: Deploy from CLI

```bash
# Install Vercel CLI (requires permissions)
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
cd ai-creative-studio
vercel

# Deploy to production
vercel --prod
```

## Neon Database Setup

### Create Neon Database

```bash
# Install Neon CLI
npm install -g neonctl

# Login
neonctl auth login

# Create project
neonctl projects create --name ai-creative-studio

# Get connection string
neonctl connection-string
```

Copy the connection string to your Vercel environment variables.

## What's Deployed

✅ **Frontend**: Vite + Vanilla JS + Tailwind CSS
✅ **Backend API**: Hono server on Vercel Edge Functions
✅ **Build**: Optimized production bundle
✅ **CDN**: Global distribution via Vercel

## Current Status

- ✅ Project initialized and forked from Open-Higgsfield-AI
- ✅ Backend infrastructure setup (Hono, Drizzle, Neon support)
- ✅ Build system working
- ✅ Tests configured (Vitest + Playwright)
- ✅ Pushed to GitHub: https://github.com/Yerdna1/ai-creative-studio

## Next Steps

To complete the 5-module workflow, implement:
1. Script module (import, parse, shot generation)
2. Character module (AI generation with Character Bible)
3. Scene module (multi-viewpoint generation)
4. Director module (timeline and cinematography)
5. S-Class module (Seedance 2.0 integration)

Each module can be developed and deployed incrementally!
