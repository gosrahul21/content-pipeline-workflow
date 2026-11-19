import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  GetFunctionCommand,
  CreateFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
  AddPermissionCommand,
} from '@aws-sdk/client-lambda';
import dotenv from 'dotenv';

dotenv.config();

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const FUNCTION_NAME = 'content-engine-api';
const ROLE_ARN = 'arn:aws:iam::629276385694:role/PowerUserRole';

const lambdaClient = new LambdaClient({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

async function deploy() {
  console.log('===============================================================');
  console.log(`🚀 DEPLOYING CONTENT ENGINE BACKEND TO AWS LAMBDA (${FUNCTION_NAME})`);
  console.log(`Region: ${REGION} | Role: ${ROLE_ARN}`);
  console.log('===============================================================\n');

  // Step 1: Bundle with esbuild
  console.log('1. Bundling backend with esbuild...');
  const buildDir = path.resolve('build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  execSync(
    'npx esbuild src/lambda.ts --bundle --platform=node --target=node20 --format=esm --outfile=build/lambda.mjs "--external:@aws-sdk/*"',
    { stdio: 'inherit' }
  );

  // Step 2: Zip bundle
  console.log('\n2. Creating deployment zip package...');
  const zipPath = path.resolve('build/lambda.zip');
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  execSync('zip -j build/lambda.zip build/lambda.mjs', { stdio: 'inherit' });

  const zipBuffer = fs.readFileSync(zipPath);
  console.log(`Zip archive size: ${(zipBuffer.length / 1024).toFixed(1)} KB`);

  // Step 3: Prepare Environment Variables (do not include reserved AWS_ keys)
  const envVars: Record<string, string> = {
    NODE_ENV: 'production',
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || 'extracted-media-bucket',
    AWS_SQS_QUEUE_URL: process.env.AWS_SQS_QUEUE_URL || '',
    AWS_EVENTBRIDGE_SCHEDULER_ENABLED: process.env.AWS_EVENTBRIDGE_SCHEDULER_ENABLED || 'true',
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || '',
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || '',
    LINKEDIN_ACCESS_TOKEN: process.env.LINKEDIN_ACCESS_TOKEN || '',
    LINKEDIN_AUTHOR_URN: process.env.LINKEDIN_AUTHOR_URN || '',
    LINKEDIN_MOCK_MODE: process.env.LINKEDIN_MOCK_MODE || 'false',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    CONTENT_NICHE: process.env.CONTENT_NICHE || 'Software Engineering and Artificial Intelligence',
    DATABASE_URL: process.env.DATABASE_URL || '',
  };

  // Step 4: Check if Lambda exists
  console.log('\n3. Checking existing Lambda function status...');
  let functionExists = false;
  try {
    await lambdaClient.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
    functionExists = true;
    console.log(`Function '${FUNCTION_NAME}' exists. Updating code and configuration...`);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`Function '${FUNCTION_NAME}' does not exist. Creating new Lambda...`);
    } else {
      throw err;
    }
  }

  if (functionExists) {
    // Update code
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: FUNCTION_NAME,
        ZipFile: zipBuffer,
      })
    );
    console.log('✅ Lambda function code updated successfully.');

    // Wait 3s for code update to finish before updating configuration
    await new Promise((r) => setTimeout(r, 3000));

    // Update config
    await lambdaClient.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: FUNCTION_NAME,
        Runtime: 'nodejs20.x',
        Handler: 'lambda.handler',
        Timeout: 60,
        MemorySize: 512,
        Environment: { Variables: envVars },
      })
    );
    console.log('✅ Lambda configuration and environment variables updated.');
  } else {
    // Create function
    await lambdaClient.send(
      new CreateFunctionCommand({
        FunctionName: FUNCTION_NAME,
        Runtime: 'nodejs20.x',
        Role: ROLE_ARN,
        Handler: 'lambda.handler',
        Code: { ZipFile: zipBuffer },
        Timeout: 60,
        MemorySize: 512,
        Environment: { Variables: envVars },
      })
    );
    console.log('✅ Lambda function created successfully.');
  }

  // Step 5: Configure Lambda Function URL for HTTPS API
  console.log('\n4. Configuring public HTTPS Function URL...');
  let functionUrl = '';
  try {
    const urlConfig = await lambdaClient.send(
      new GetFunctionUrlConfigCommand({ FunctionName: FUNCTION_NAME })
    );
    functionUrl = urlConfig.FunctionUrl || '';
    console.log('Found existing Function URL:', functionUrl);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      console.log('Creating new Function URL with CORS...');
      const createUrlRes = await lambdaClient.send(
        new CreateFunctionUrlConfigCommand({
          FunctionName: FUNCTION_NAME,
          AuthType: 'NONE',
          Cors: {
            AllowOrigins: ['*'],
            AllowMethods: ['*'],
            AllowHeaders: ['*'],
            MaxAge: 86400,
          },
        })
      );
      functionUrl = createUrlRes.FunctionUrl || '';
      console.log('Created Function URL:', functionUrl);

      // Add permission for public invocation
      try {
        await lambdaClient.send(
          new AddPermissionCommand({
            FunctionName: FUNCTION_NAME,
            StatementId: 'FunctionURLAllowPublicAccess',
            Action: 'lambda:InvokeFunctionUrl',
            Principal: '*',
            FunctionUrlAuthType: 'NONE',
          })
        );
        console.log('Added public invoke permission to Function URL.');
      } catch (permErr: any) {
        console.warn('Permission notice:', permErr.message);
      }
    } else {
      throw err;
    }
  }

  // Step 6: Test health check
  console.log('\n5. Verifying live deployment...');
  console.log(`Pinging ${functionUrl}health ...`);
  try {
    const { default: axios } = await import('axios');
    const healthRes = await axios.get(`${functionUrl}health`, { timeout: 15000 });
    console.log('Live Health Response:', healthRes.data);
  } catch (pingErr: any) {
    console.warn('Health ping warning:', pingErr.message);
  }

  console.log('\n===============================================================');
  console.log('🎉 DEPLOYMENT COMPLETE!');
  console.log(`Public Endpoint: ${functionUrl}`);
  console.log(`Health Check:    ${functionUrl}health`);
  console.log(`Ingest Endpoint: ${functionUrl}api/feed/ingest`);
  console.log(`Posts Endpoint:  ${functionUrl}api/posts`);
  console.log('===============================================================');
}

deploy().catch((err) => {
  console.error('\n❌ Deployment failed:', err);
  process.exit(1);
});
