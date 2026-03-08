import { Hono } from 'hono';

const app = new Hono();

// GET /api/director - Get timeline
app.get('/', (c) => {
  return c.json({
    timeline: [],
    totalDuration: 0
  });
});

// POST /api/director/timeline - Create/update timeline
app.post('/timeline', async (c) => {
  const body = await c.req.json();
  return c.json({
    id: crypto.randomUUID(),
    shots: body.shots || [],
    totalDuration: body.totalDuration || 0,
    createdAt: new Date().toISOString()
  });
});

// POST /api/director/batch - Batch process shots
app.post('/batch', async (c) => {
  const body = await c.req.json();
  return c.json({
    status: 'processing',
    shotsCount: body.shots?.length || 0,
    message: 'Batch processing started'
  });
});

export default app;
