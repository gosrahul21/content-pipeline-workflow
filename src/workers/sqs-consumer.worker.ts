import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { config } from '../config/env.js';
import { sqsProcessorService } from '../services/sqs-processor.service.js';

const sqsClient = new SQSClient({
  region: config.aws.region,
  credentials: config.aws.accessKeyId && config.aws.secretAccessKey
    ? {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      }
    : undefined,
});

async function startWorker() {
  const queueUrl = config.aws.sqsQueueUrl;
  console.log('====================================================');
  console.log(`🤖 Content Engine SQS Polling Worker Started`);
  console.log(`Target Queue: ${queueUrl || 'None configured (Set AWS_SQS_QUEUE_URL)'}`);
  console.log('====================================================\n');

  if (!queueUrl) {
    console.warn('⚠️ No SQS_QUEUE_URL configured. Exiting worker.');
    process.exit(1);
  }

  while (true) {
    try {
      const receiveCmd = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 15, // Long polling
        MessageAttributeNames: ['All'],
      });

      const response = await sqsClient.send(receiveCmd);

      if (response.Messages && response.Messages.length > 0) {
        console.log(`[Worker] Received ${response.Messages.length} message(s) from SQS...`);

        for (const msg of response.Messages) {
          try {
            if (msg.Body) {
              const payload = JSON.parse(msg.Body);
              await sqsProcessorService.processSqsPost(payload);
            }

            // Acknowledge and delete message from SQS on successful processing
            if (msg.ReceiptHandle) {
              await sqsClient.send(
                new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: msg.ReceiptHandle,
                })
              );
              console.log(`[Worker] Acknowledged & deleted message ${msg.MessageId}`);
            }
          } catch (err: any) {
            console.error(`[Worker] Error processing message ${msg.MessageId}:`, err.message);
          }

          // 5-second pacing delay between SQS messages to stay under 15 RPM
          console.log('[Worker] ⏳ Waiting 5 seconds before processing next message...');
          await new Promise((res) => setTimeout(res, 5000));
        }
      }
    } catch (err: any) {
      console.error('[Worker] SQS Polling error:', err.message);
      // Wait before retrying to prevent hot loop on connection or auth errors
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}

startWorker().catch(console.error);
