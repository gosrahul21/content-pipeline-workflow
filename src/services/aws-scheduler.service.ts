import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  ActionAfterCompletion,
} from '@aws-sdk/client-scheduler';
import { config } from '../config/env.js';

export class AwsSchedulerService {
  private client: SchedulerClient | null = null;

  constructor() {
    if (config.aws.eventBridgeSchedulerEnabled && config.aws.lambdaTargetArn && config.aws.schedulerRoleArn) {
      this.client = new SchedulerClient({ region: config.aws.region });
    }
  }

  /**
   * Schedule a one-time exact trigger in AWS EventBridge Scheduler
   * @param postId ID of the post
   * @param scheduledAt Date object when it should trigger
   */
  public async schedulePost(postId: string, scheduledAt: Date): Promise<boolean> {
    const scheduleName = `publish-post-${postId}`;
    // EventBridge Scheduler format: "at(YYYY-MM-DDTHH:mm:ss)"
    const isoString = scheduledAt.toISOString().split('.')[0];
    const scheduleExpression = `at(${isoString})`;

    if (!this.client || !config.aws.eventBridgeSchedulerEnabled) {
      console.log(`[AwsSchedulerService] (Local/Mock Mode) Registered schedule '${scheduleName}' for ${scheduleExpression}`);
      return true;
    }

    try {
      const command = new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        FlexibleTimeWindow: {
          Mode: FlexibleTimeWindowMode.OFF,
        },
        Target: {
          Arn: config.aws.lambdaTargetArn,
          RoleArn: config.aws.schedulerRoleArn,
          Input: JSON.stringify({
            source: 'aws.scheduler',
            action: 'PUBLISH_POST',
            postId,
          }),
        },
        ActionAfterCompletion: ActionAfterCompletion.DELETE, // Automatically clean up schedule when fired
      });

      await this.client.send(command);
      console.log(`[AwsSchedulerService] Created EventBridge schedule '${scheduleName}' at ${scheduleExpression}`);
      return true;
    } catch (err: any) {
      console.error(`[AwsSchedulerService] Failed to create schedule for post ${postId}:`, err.message);
      return false;
    }
  }

  /**
   * Delete a one-time schedule when a post is cancelled or rescheduled
   */
  public async cancelSchedule(postId: string): Promise<boolean> {
    const scheduleName = `publish-post-${postId}`;

    if (!this.client || !config.aws.eventBridgeSchedulerEnabled) {
      console.log(`[AwsSchedulerService] (Local/Mock Mode) Cancelled schedule '${scheduleName}'`);
      return true;
    }

    try {
      const command = new DeleteScheduleCommand({ Name: scheduleName });
      await this.client.send(command);
      console.log(`[AwsSchedulerService] Deleted EventBridge schedule '${scheduleName}'`);
      return true;
    } catch (err: any) {
      console.warn(`[AwsSchedulerService] Could not delete schedule '${scheduleName}':`, err.message);
      return false;
    }
  }
}

export const awsSchedulerService = new AwsSchedulerService();
