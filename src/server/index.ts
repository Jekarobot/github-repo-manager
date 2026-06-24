import express from 'express';
import * as path from 'path';
import * as dotenv from 'dotenv';
import apiRouter from './routes/api';
import { sseMiddleware, sendEvent, sendLog } from './middleware/sse';
import { pushConfirm } from './push-confirm';
import { setSseCallback } from '../core/logger';

dotenv.config();

// Все логи из logger() будут дублироваться в SSE
setSseCallback(sendLog);

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

// Push confirmation event → SSE
pushConfirm.on('confirm', (repoName: string, readmeContent: string) => {
  sendEvent('confirm-push', { repoName, readmeContent });
});

app.listen(PORT, () => {
  console.log(`🌐 Веб-интерфейс запущен: http://localhost:${PORT}`);
  console.log(`📄 Конфиг: ${process.env.CONFIG_PATH || './repos.config.json'}`);
  console.log('🔧 Нажми Ctrl+C для остановки');
});