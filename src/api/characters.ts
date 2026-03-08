import { Hono } from 'hono';

const app = new Hono();

// GET /api/characters - List all characters
app.get('/', (c) => {
  return c.json({ characters: [] });
});

// POST /api/characters - Create new character
app.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({
    id: crypto.randomUUID(),
    ...body,
    createdAt: new Date().toISOString()
  });
});

// POST /api/characters/:id/generate - Generate character with AI
app.post('/:id/generate', async (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    status: 'generating',
    message: 'Character generation started'
  });
});

export default app;
