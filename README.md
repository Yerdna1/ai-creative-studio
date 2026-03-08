# AI Creative Studio

AI-powered creative studio for film/video production with 5-module workflow.

## Features

- **Script Module**: Import and parse scripts, generate shots with cinematic language
- **Character Module**: AI character generation with Character Bible for consistency
- **Scene Module**: Multi-viewpoint scene generation
- **Director Module**: Timeline and cinematography profiles
- **S-Class Module**: Seedance 2.0 integration for video generation

## Tech Stack

- **Frontend**: Vite + Vanilla JavaScript ES6 + Tailwind CSS v4
- **Backend**: Hono (Vercel Edge Functions)
- **Database**: Neon PostgreSQL with Drizzle ORM
- **Testing**: Vitest + Playwright

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

This app is designed to be deployed to Vercel with automatic deployments on git push.

### Environment Variables

Create a `.env` file or configure in Vercel dashboard:

```
DATABASE_URL=postgresql://user:pass@ep-xyz.aws.neon.tech/ai-creative-studio
SEEDANCE_API_KEY=sk-...
AI_PROVIDER_API_KEY=sk-...
```

## 5-Module Workflow

1. **Script**: Import your script, automatically parse episodes and shots
2. **Characters**: Generate AI characters with consistent Character Bible
3. **Scenes**: Create multi-viewpoint scene images
4. **Director**: Organize shots into timeline with cinematography controls
5. **S-Class**: Generate final video with Seedance 2.0

## License

MIT
