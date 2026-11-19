import { app } from './app.js';
import { config } from './config/env.js';
import { telegramService } from './services/telegram.service.js';
// Start HTTP server for local development or container deployment
const server = app.listen(config.port, () => {
    console.log(`\n=================================================`);
    console.log(`🚀 Content Engine Backend listening on port ${config.port}`);
    console.log(`📡 Health Check:  http://localhost:${config.port}/health`);
    console.log(`🔑 Connect LinkedIn: http://localhost:${config.port}/api/auth/linkedin`);
    console.log(`📝 Posts API:     http://localhost:${config.port}/api/posts`);
    console.log(`💼 LinkedIn Mode: ${config.linkedin.mockMode ? 'MOCK / SIMULATED' : 'LIVE'}`);
    console.log(`⚡ Scheduling:    AWS EventBridge Scheduler (Option 1)`);
    console.log(`=================================================\n`);
    // Start Telegram polling if bot is configured and no webhook is set
    if (telegramService.isConfigured()) {
        telegramService.startPolling().catch((err) => {
            console.warn('[Server] Could not start Telegram polling:', err.message);
        });
    }
});
// Graceful shutdown
const shutdown = () => {
    console.log('\n[Server] Shutting down gracefully...');
    telegramService.stopPolling();
    server.close(() => {
        console.log('[Server] HTTP server closed.');
        process.exit(0);
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
