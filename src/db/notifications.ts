import { Client } from 'pg';
import { getPool } from './connection';

const NOTIFICATION_CHANNEL = 'job_available';

/**
 * Send a notification to wake up workers when a new job is available.
 * This uses PostgreSQL's NOTIFY feature for real-time notifications.
 */
export async function notifyJobAvailable(): Promise<void> {
  const pool = getPool();
  await pool.query(`NOTIFY ${NOTIFICATION_CHANNEL}`);
}

/**
 * Create a dedicated client connection for listening to notifications.
 * LISTEN requires a dedicated connection (cannot use connection pool).
 */
export async function createNotificationListener(
  onNotification: () => void
): Promise<Client> {
  const databaseUrl = process.env.DATABASE_URL;
  const client = new Client({
    connectionString: databaseUrl,
  });

  await client.connect();

  // Set up notification handler
  client.on('notification', (msg) => {
    if (msg.channel === NOTIFICATION_CHANNEL) {
      onNotification();
    }
  });

  // Listen for notifications
  await client.query(`LISTEN ${NOTIFICATION_CHANNEL}`);

  // Handle connection errors
  client.on('error', (err) => {
    console.error('[NotificationListener] Connection error:', err);
  });

  return client;
}

/**
 * Stop listening and close the notification client.
 */
export async function closeNotificationListener(client: Client): Promise<void> {
  try {
    await client.query(`UNLISTEN ${NOTIFICATION_CHANNEL}`);
  } catch (error) {
    console.error('[NotificationListener] Error unlistening:', error);
  } finally {
    await client.end();
  }
}

