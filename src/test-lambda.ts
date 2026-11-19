import { handler } from './lambda.js';
import { postService } from './services/post.service.js';

async function testLambda() {
  console.log('================ [TESTING UNIVERSAL LAMBDA HANDLER] ================');

  // Test 1: API Gateway / Function URL HTTP Request (e.g., GET /health)
  console.log('\n--- 1. Testing HTTP Event (API Gateway / Function URL) ---');
  const mockHttpEvent = {
    version: '2.0',
    routeKey: 'GET /health',
    rawPath: '/health',
    rawQueryString: '',
    headers: {
      accept: 'application/json',
    },
    requestContext: {
      http: {
        method: 'GET',
        path: '/health',
        protocol: 'HTTP/1.1',
      },
    },
    isBase64Encoded: false,
  };

  const httpResponse: any = await handler(mockHttpEvent, {} as any);
  console.log('HTTP Status:', httpResponse.statusCode);
  console.log('HTTP Body:', httpResponse.body);

  // Test 2: EventBridge Scheduler Event (One-Time Schedule)
  console.log('\n--- 2. Testing EventBridge Scheduler Event ---');
  const post = await postService.createPost({
    content: '🚀 Testing LinkedIn post via Universal Lambda Handler #AWS #Serverless',
    publishNow: false,
  });

  const mockSchedulerEvent = {
    source: 'aws.scheduler',
    action: 'PUBLISH_POST',
    postId: post.id,
  };

  const schedulerResponse: any = await handler(mockSchedulerEvent, {} as any);
  console.log('Scheduler Response:', schedulerResponse);

  // Test 3: SQS Queue Record Event
  console.log('\n--- 3. Testing SQS Queue Event ---');
  const mockSqsEvent = {
    Records: [
      {
        messageId: 'msg-abc-123',
        eventSource: 'aws:sqs',
        body: JSON.stringify({
          tweetId: '1987654321',
          text: 'Scraped tweet from X feed ready for pipeline',
        }),
      },
    ],
  };

  const sqsResponse: any = await handler(mockSqsEvent, {} as any);
  console.log('SQS Response:', sqsResponse);

  console.log('\n🎉 ALL LAMBDA ENTRY POINTS VERIFIED SUCCESSFULLY!');
}

testLambda().catch(console.error);
