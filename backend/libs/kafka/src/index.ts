/**
 * Thin wrapper over the Confluent Kafka client (KafkaJS-compatible API). Works with Redpanda locally
 * and MSK/Confluent in the cloud. Producers are idempotent; consumers commit after the handler succeeds,
 * so handlers MUST be idempotent (dedupe on the CloudEvent id — see @ac/nest-common EventsModule).
 */
import type { KafkaJS as KafkaJSNs } from '@confluentinc/kafka-javascript';

/**
 * The client wraps a native library (librdkafka). Load it lazily so a service without Kafka needs —
 * or a machine with a broken native install — still boots; callers get a clear error instead.
 * Fix a broken binary with: pnpm rebuild @confluentinc/kafka-javascript
 */
let lib: typeof KafkaJSNs | undefined;
async function kafkaJS(): Promise<typeof KafkaJSNs> {
  if (!lib) {
    try {
      lib = (await import('@confluentinc/kafka-javascript')).KafkaJS;
    } catch (e) {
      throw new Error(`Kafka client native module failed to load (${(e as Error).message.split('\n')[0]}) — run: pnpm rebuild @confluentinc/kafka-javascript`);
    }
  }
  return lib;
}

export interface KafkaMessageOut {
  key: string;
  value: string;
  headers?: Record<string, string>;
}
export interface KafkaMessageIn {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

const brokers = () => (process.env.KAFKA_BROKERS ?? 'localhost:59092').split(',').map((b) => b.trim());

/**
 * Auth: none locally (Redpanda). In AWS set KAFKA_SASL_MECHANISM=aws-msk-iam (+ AWS_REGION): MSK Serverless IAM
 * auth via OAUTHBEARER tokens signed with the task role — each service's role only grants its own topics/groups.
 */
async function authConfig() {
  if (process.env.KAFKA_SASL_MECHANISM !== 'aws-msk-iam') return {};
  const { generateAuthToken } = await import('aws-msk-iam-sasl-signer-js');
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  return {
    ssl: true,
    sasl: {
      mechanism: 'oauthbearer' as const,
      oauthBearerProvider: async () => {
        const { token, expiryTime } = await generateAuthToken({ region });
        // librdkafka expects the absolute expiry in ms since the epoch
        return { value: token, principal: process.env.SERVICE_NAME ?? 'service', lifetime: expiryTime };
      },
    },
  };
}

export async function createKafka(clientId: string) {
  const KafkaJS = await kafkaJS();
  return new KafkaJS.Kafka({ kafkaJS: { clientId, brokers: brokers(), logLevel: KafkaJS.logLevel.WARN, ...(await authConfig()) } });
}

export async function createProducer(clientId: string) {
  const producer = (await createKafka(clientId)).producer({ kafkaJS: { idempotent: true, acks: -1 } });
  await producer.connect();
  return {
    send: (topic: string, messages: KafkaMessageOut[]) => producer.send({ topic, messages }),
    disconnect: () => producer.disconnect(),
  };
}

export async function createConsumer(
  clientId: string,
  groupId: string,
  topics: string[],
  handler: (msg: KafkaMessageIn) => Promise<void>,
) {
  const consumer = (await createKafka(clientId)).consumer({ kafkaJS: { groupId, fromBeginning: true } });
  await consumer.connect();
  await consumer.subscribe({ topics });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(message.headers ?? {})) if (v != null) headers[k] = v.toString();
      await handler({ topic, partition, offset: message.offset, key: message.key?.toString() ?? null, value: message.value?.toString() ?? null, headers });
    },
  });
  return { disconnect: () => consumer.disconnect() };
}
