import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import postRoutes from './routes/post.routes.js';
import authRoutes from './routes/auth.routes.js';
import supervisionRoutes from './routes/supervision.routes.js';
import { postController } from './controllers/post.controller.js';
export const app = express();
app.use(cors());
app.use(express.json());
// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        linkedinMode: config.linkedin.mockMode ? 'MOCK_SIMULATED' : 'LIVE',
        runtime: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'AWS_LAMBDA' : 'STANDALONE_SERVER',
        linkedinAuthorized: Boolean(config.linkedin.accessToken && config.linkedin.authorUrn),
        sqsQueueConfigured: Boolean(config.aws.sqsQueueUrl),
        database: config.db.url ? 'NEON_POSTGRES' : 'LOCAL_FILE_STORE',
    });
});
// Chrome Extension Ingestion & SQS endpoint
app.post('/api/feed/ingest', (req, res) => postController.publishToSqs(req, res));
// Auth & Post routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/supervision', supervisionRoutes);
// Global error handler
app.use((err, _req, res, _next) => {
    console.error('[Unhandled Error]:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
});
