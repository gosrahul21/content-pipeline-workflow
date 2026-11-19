import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:4000/api/auth/linkedin/callback',
    accessToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
    authorUrn: process.env.LINKEDIN_AUTHOR_URN || '',
    apiVersion: process.env.LINKEDIN_API_VERSION || '202601',
    mockMode: process.env.LINKEDIN_MOCK_MODE === 'true' || !process.env.LINKEDIN_ACCESS_TOKEN,
  },

  scheduler: {
    defaultWindowStart: '09:00',
    defaultWindowEnd: '21:00',
    defaultMinGapMinutes: 30,
    defaultJitterMinutes: 3,
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-southeast-2',
    s3Bucket: process.env.AWS_S3_BUCKET || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sqsQueueUrl: process.env.AWS_SQS_QUEUE_URL || process.env.SQS_QUEUE_URL || '',
    lambdaTargetArn: process.env.AWS_LAMBDA_TARGET_ARN || '',
    schedulerRoleArn: process.env.AWS_SCHEDULER_ROLE_ARN || '',
    eventBridgeSchedulerEnabled: process.env.AWS_EVENTBRIDGE_SCHEDULER_ENABLED === 'true',
    sqsMockMode: process.env.SQS_MOCK_MODE === 'true',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  content: {
    niche: process.env.CONTENT_NICHE || 'Software Engineering and Artificial Intelligence',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },

  db: {
    url: process.env.DATABASE_URL || '',
    enabled: Boolean(process.env.DATABASE_URL),
  }
};
