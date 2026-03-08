import { Hono } from 'hono';
import { cors } from 'hono/cors';
import scripts from './scripts.ts';
import characters from './characters.ts';
import scenes from './scenes.ts';
import director from './director.ts';
import sclass from './sclass.ts';

const app = new Hono();

// CORS middleware
app.use('/*', cors({
  origin: '*',
  credentials: true,
}));

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount module routes
app.route('/api/scripts', scripts);
app.route('/api/characters', characters);
app.route('/api/scenes', scenes);
app.route('/api/director', director);
app.route('/api/sclass', sclass);

// Projects endpoints (placeholder)
app.get('/api/projects', (c) => {
  return c.json({ projects: [] });
});

app.post('/api/projects', (c) => {
  return c.json({ message: 'Project created', id: crypto.randomUUID() });
});

// Export for Vercel Edge Functions
export default app;
