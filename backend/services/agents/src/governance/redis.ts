import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { connect, type Socket } from 'node:net';

/**
 * Minimal RESP2 client (GET / SET EX / INCR / EXPIRE / DEL) for governance counters and caches.
 * Why not ioredis/redis: both are optional peers of TypeORM, and installing either makes pnpm create a second
 * TypeORM instance → Nest DI breaks (seen in P2). This needs ~5 commands, so a 100-line client is the safer choice.
 * Commands are pipelined over one connection; a broken connection is re-opened on the next command.
 * Callers treat RedisUnavailable as "cache miss" (autonomy → DB) or fail closed (budgets → deny).
 */
export class RedisUnavailable extends Error {}

type Reply = string | number | null | Reply[];

@Injectable()
export class RedisClient implements OnModuleDestroy {
  private readonly log = new Logger(RedisClient.name);
  private socket?: Socket;
  private ready?: Promise<void>;
  private buf = Buffer.alloc(0);
  private queue: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = [];

  private url() {
    return new URL(process.env.REDIS_URL ?? 'redis://localhost:56379');
  }

  private open(): Promise<void> {
    if (this.ready) return this.ready;
    const u = this.url();
    this.ready = new Promise<void>((resolve, reject) => {
      const s = connect({ host: u.hostname, port: Number(u.port || 6379) });
      const fail = (e: Error) => {
        this.reset(e);
        reject(new RedisUnavailable(e.message));
      };
      s.setTimeout(2000, () => s.destroy(new Error('redis timeout')));
      s.once('error', fail);
      s.on('data', (d) => this.onData(d));
      s.on('close', () => this.reset(new Error('redis connection closed')));
      s.once('connect', () => {
        s.setTimeout(0);
        this.socket = s;
        const pass = decodeURIComponent(u.password);
        const user = decodeURIComponent(u.username);
        if (!pass) return resolve();
        this.write(user ? ['AUTH', user, pass] : ['AUTH', pass]).then(() => resolve(), fail);
      });
    });
    return this.ready;
  }

  private reset(e: Error) {
    for (const q of this.queue.splice(0)) q.reject(new RedisUnavailable(e.message));
    this.socket?.destroy();
    this.socket = undefined;
    this.ready = undefined;
    this.buf = Buffer.alloc(0);
  }

  private write(args: (string | number)[]): Promise<Reply> {
    const parts = args.map(String);
    const cmd = `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
    return new Promise<Reply>((resolve, reject) => {
      if (!this.socket) return reject(new RedisUnavailable('not connected'));
      this.queue.push({ resolve, reject });
      this.socket.write(cmd);
    });
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const r = parse(this.buf, 0);
      if (!r) return;
      this.buf = this.buf.subarray(r.end);
      const q = this.queue.shift();
      if (!q) continue;
      if (r.value instanceof Error) q.reject(r.value);
      else q.resolve(r.value as Reply);
    }
  }

  async cmd(...args: (string | number)[]): Promise<Reply> {
    await this.open();
    return Promise.race([
      this.write(args),
      new Promise<Reply>((_, rej) => setTimeout(() => rej(new RedisUnavailable('redis command timeout')), 1500)),
    ]);
  }

  get = (k: string) => this.cmd('GET', k) as Promise<string | null>;
  setEx = (k: string, v: string, sec: number) => this.cmd('SET', k, v, 'EX', sec);
  del = (k: string) => this.cmd('DEL', k);
  /** INCR + EXPIRE on first use; returns the new value */
  async incrWithTtl(k: string, sec: number): Promise<number> {
    const n = Number(await this.cmd('INCR', k));
    if (n === 1) await this.cmd('EXPIRE', k, sec);
    return n;
  }

  onModuleDestroy() {
    this.socket?.end();
  }
}

/** RESP2 parser: returns undefined until a full reply is buffered. */
export function parse(b: Buffer, i: number): { value: Reply | Error; end: number } | undefined {
  const nl = b.indexOf('\r\n', i);
  if (nl < 0) return undefined;
  const type = String.fromCharCode(b[i]);
  const line = b.toString('utf8', i + 1, nl);
  switch (type) {
    case '+':
      return { value: line, end: nl + 2 };
    case '-':
      return { value: new Error(line), end: nl + 2 };
    case ':':
      return { value: Number(line), end: nl + 2 };
    case '$': {
      const len = Number(line);
      if (len < 0) return { value: null, end: nl + 2 };
      if (b.length < nl + 2 + len + 2) return undefined;
      return { value: b.toString('utf8', nl + 2, nl + 2 + len), end: nl + 2 + len + 2 };
    }
    case '*': {
      const n = Number(line);
      if (n < 0) return { value: null, end: nl + 2 };
      const out: Reply[] = [];
      let pos = nl + 2;
      for (let k = 0; k < n; k++) {
        const r = parse(b, pos);
        if (!r) return undefined;
        out.push(r.value as Reply);
        pos = r.end;
      }
      return { value: out, end: pos };
    }
    default:
      return { value: new Error(`unexpected RESP type ${type}`), end: nl + 2 };
  }
}
