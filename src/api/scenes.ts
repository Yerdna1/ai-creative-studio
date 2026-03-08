import { Hono } from 'hono';

const app = new Hono();

// GET /api/scenes - List all scenes
app.get('/', (c) => {
  return c.json({ scenes: [] });
});

// POST /api/scenes - Create new scene
app.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({
    id: crypto.randomUUID(),
    ...body,
    createdAt: new Date().toISOString()
  });
});

// POST /api/scenes/:id/generate-viewpoints - Generate scene viewpoints
app.post('/:id/generate-viewpoints', async (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    viewpoints: ['Front', 'Side', 'Top', 'Wide', 'Close'],
    status: 'generating'
  });
});

export default app;
