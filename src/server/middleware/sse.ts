import { Request, Response } from 'express';

const clients: Response[] = [];

export function sseMiddleware(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write('data: {"type":"connected"}\n\n');

  clients.push(res);

  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
}

export function sendLog(message: string): void {
  const data = JSON.stringify({ type: 'log', message, timestamp: new Date().toISOString() });
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

export function sendEvent(event: string, payload: Record<string, unknown>): void {
  const data = JSON.stringify({ type: event, ...payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}