import { Hono } from 'hono';
import { cors } from 'hono/cors';

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

// Projects endpoints (placeholder)
app.get('/api/projects', (c) => {
  return c.json({ projects: [] });
});

app.post('/api/projects', (c) => {
  return c.json({ message: 'Project created', id: 'placeholder' });
});

// Export for Vercel Edge Functions
export default app;
