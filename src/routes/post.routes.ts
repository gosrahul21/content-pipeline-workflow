import { Router } from 'express';
import { postController } from '../controllers/post.controller.js';

const router = Router();

// Post CRUD & Actions
router.post('/', (req, res) => postController.create(req, res));
router.get('/', (req, res) => postController.list(req, res));
router.get('/:id', (req, res) => postController.getById(req, res));

// Batch scheduling with random window distribution
router.post('/schedule-batch', (req, res) => postController.scheduleBatch(req, res));

// Deduplication checks (first 50 characters matching)
router.post('/check-duplicate', (req, res) => postController.checkDuplicate(req, res));
router.post('/check-batch-duplicates', (req, res) => postController.checkBatchDuplicates(req, res));

// SQS Ingestion & Publishing for Chrome Extension & external scrapers
router.post('/publish-to-sqs', (req, res) => postController.publishToSqs(req, res));
router.post('/queue', (req, res) => postController.publishToSqs(req, res));

// Lifecycle actions
router.post('/:id/publish-now', (req, res) => postController.publishNow(req, res));
router.patch('/:id/reschedule', (req, res) => postController.reschedule(req, res));
router.post('/:id/cancel', (req, res) => postController.cancel(req, res));

export default router;
