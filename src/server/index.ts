import express from 'express';
import * as path from 'path';
import * as dotenv from 'dotenv';
import apiRouter from './routes/api';
import { sseMiddleware } from './middleware/sse';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../../public')));

// API routes
app.use('/api', apiRouter);

// SSE endpoint
app.get('/api/logs', sseMiddleware);

// SPA fallback — все маршруты отдают index.html
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🌐 Веб-интерфейс запущен: http://localhost:${PORT}`);
  console.log(`📄 Конфиг: ${process.env.CONFIG_PATH || './repos.config.json'}`);
  console.log('🔧 Нажми Ctrl+C для остановки');
});