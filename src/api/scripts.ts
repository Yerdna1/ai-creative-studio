import { Hono } from 'hono';

const app = new Hono();

// GET /api/scripts - List all scripts
app.get('/', (c) => {
  return c.json({ scripts: [] });
});

// POST /api/scripts - Create new script
app.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({
    id: crypto.randomUUID(),
    ...body,
    createdAt: new Date().toISOString()
  });
});

// GET /api/scripts/:id - Get script by ID
app.get('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    title: 'Sample Script',
    episodes: [],
    createdAt: new Date().toISOString()
  });
});

// POST /api/scripts/:id/parse - Parse script
app.post('/:id/parse', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const episodes = (body.content || '').split(/\n\n+/).filter(block => block.length > 50);

  return c.json({
    id,
    episodes: episodes.map((ep, i) => ({
      number: i + 1,
      title: `Episode ${i + 1}`,
      content: ep.substring(0, 200),
      shotsCount: Math.ceil(ep.split(/\s+/).length / 150)
    }))
  });
});

export default app;
