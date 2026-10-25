import { type CallHandler, ConflictException, type ExecutionContext, Injectable, type NestInterceptor, SetMetadata, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { DataSource } from 'typeorm';

export const IDEMPOTENT = 'ac:idempotent';
/** Mark a mutating money/stock route: requires `Idempotency-Key`, replays the stored response on retry. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/** Registered globally by CoreModule for services with a database; only acts on @Idempotent() routes. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly db: DataSource) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    return from(this.handle(ctx, next));
  }

  private async handle(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const reply = ctx.switchToHttp().getResponse();
    const key: string | undefined = req.headers['idempotency-key'];
    if (!key || key.length > 200) throw new BadRequestException('Idempotency-Key header is required');
    const principal = req.principal?.sub ?? 'anonymous';
    const hash = createHash('sha256').update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`).digest('hex');

    const inserted = await this.db.query(
      `INSERT INTO idempotency_keys (key, principal_id, request_hash, status) VALUES ($1, $2, $3, 'IN_PROGRESS')
       ON CONFLICT DO NOTHING RETURNING key`,
      [key, principal, hash],
    );
    if (!inserted.length) {
      const [row] = await this.db.query(`SELECT * FROM idempotency_keys WHERE key = $1 AND principal_id = $2`, [key, principal]);
      if (row.request_hash !== hash) throw new UnprocessableEntityException('Idempotency-Key reused with a different request');
      if (row.status !== 'COMPLETED') throw new ConflictException('A request with this Idempotency-Key is still in progress');
      reply.status(row.response_code);
      reply.header('idempotent-replayed', 'true');
      return row.response_body;
    }
    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.db.query(
        `UPDATE idempotency_keys SET status = 'COMPLETED', response_code = $3, response_body = $4 WHERE key = $1 AND principal_id = $2`,
        [key, principal, reply.statusCode ?? 200, JSON.stringify(body ?? null)],
      );
      return body;
    } catch (e) {
      await this.db.query(`DELETE FROM idempotency_keys WHERE key = $1 AND principal_id = $2`, [key, principal]);
      throw e;
    }
  }
}
