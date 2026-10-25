import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, type EventData, type EventType, Events, TOPICS } from '@ac/contracts';
import { EventConsumerService } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { DataSource, type EntityManager } from 'typeorm';
import { type Kind, render, type TemplateData } from './templates.js';

const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r);
const MAX_ATTEMPTS = 5;

/**
 * order.events + payment.events → one notification per event × channel (in-app always, email when an address is
 * known). Rows are written in the consumer transaction (idempotent: UNIQUE(event_id, channel)); a sender loop
 * delivers PENDING emails over SMTP with retries/backoff — the notification table is the email outbox.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(NotificationsService.name);
  private mailer?: Transporter;
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly db: DataSource, private readonly events: EventConsumerService) {}

  async onModuleInit() {
    if (process.env.SMTP_URL) this.mailer = nodemailer.createTransport(process.env.SMTP_URL);
    else this.log.warn('SMTP_URL unset — notifications are in-app only');
    await this.events.subscribe('notify-orders', [TOPICS.order, TOPICS.payment], (e, tx) => this.handle(e, tx));
    this.timer = setInterval(() => void this.sendPending(), Number(process.env.NOTIFY_SEND_MS ?? 2_000));
  }
  onApplicationShutdown() {
    clearInterval(this.timer);
    this.mailer?.close();
  }

  private parse<T extends EventType>(type: T, evt: CloudEvent): EventData<T> | null {
    const r = Events[type].safeParse(evt);
    if (!r.success) this.log.error(`skipping invalid ${type} ${evt.id}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    return r.success ? (r.data.data as EventData<T>) : null;
  }

  private async contact(tx: EntityManager, orderId: string, userId: string | null, orderNo: string | null, email: string | null) {
    if (userId && orderNo) {
      await tx.query(
        `INSERT INTO order_contacts (order_id, user_id, order_no, email) VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_id) DO UPDATE SET email = coalesce(EXCLUDED.email, order_contacts.email), order_no = EXCLUDED.order_no, updated_at = now()`,
        [orderId, userId, orderNo, email],
      );
    }
    const [c] = await tx.query(`SELECT * FROM order_contacts WHERE order_id = $1`, [orderId]);
    return c as { user_id: string; order_no: string; email: string | null } | undefined;
  }

  private async record(tx: EntityManager, evt: CloudEvent, kind: Kind, orderId: string, c: { user_id: string; order_no: string; email: string | null }, data: Omit<TemplateData, 'orderNo' | 'appUrl'>) {
    const r = render(kind, { ...data, orderNo: c.order_no, appUrl: (process.env.APP_PUBLIC_URL ?? 'http://localhost:3300').replace(/\/$/, '') });
    const ins = `INSERT INTO notifications (id, event_id, channel, user_id, order_id, kind, to_address, subject, body_text, body_html, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (event_id, channel) DO NOTHING`;
    await tx.query(ins, [randomUUID(), evt.id, 'in_app', c.user_id, orderId, kind, null, r.subject, r.text, null, 'UNREAD']);
    if (c.email) await tx.query(ins, [randomUUID(), evt.id, 'email', c.user_id, orderId, kind, c.email, r.subject, r.text, r.html, 'PENDING']);
  }

  async handle(evt: CloudEvent, tx: EntityManager) {
    switch (evt.type) {
      case 'order.created.v1': {
        const d = this.parse('order.created.v1', evt);
        if (d?.orderNo) await this.contact(tx, d.orderId, d.buyerId, d.orderNo, null);
        return;
      }
      case 'order.confirmed.v1': {
        const d = this.parse('order.confirmed.v1', evt);
        if (!d) return;
        const c = await this.contact(tx, d.orderId, d.buyerId, d.orderNo, d.notifyEmail);
        if (c) await this.record(tx, evt, 'ORDER_CONFIRMED', d.orderId, c, { lines: d.lines, totalMinor: d.total.amountMinor });
        return;
      }
      case 'order.shipped.v1': {
        const d = this.parse('order.shipped.v1', evt);
        if (!d) return;
        const c = await this.contact(tx, d.orderId, d.buyerId, d.orderNo, d.notifyEmail);
        if (c) await this.record(tx, evt, 'ORDER_SHIPPED', d.orderId, c, { carrier: d.carrier, trackingNo: d.trackingNo });
        return;
      }
      case 'order.delivered.v1': {
        const d = this.parse('order.delivered.v1', evt);
        if (!d) return;
        const c = await this.contact(tx, d.orderId, d.buyerId, d.orderNo, d.notifyEmail);
        if (c) await this.record(tx, evt, 'ORDER_DELIVERED', d.orderId, c, {});
        return;
      }
      case 'order.cancelled.v1': {
        const d = this.parse('order.cancelled.v1', evt);
        if (!d) return;
        const c = await this.contact(tx, d.orderId, d.buyerId, d.orderNo, d.notifyEmail);
        if (c) await this.record(tx, evt, 'ORDER_CANCELLED', d.orderId, c, { reason: d.reason, note: d.note, refundRequired: d.refundRequired, amountMinor: d.amount.amountMinor });
        return;
      }
      case 'payment.failed.v1': {
        const d = this.parse('payment.failed.v1', evt);
        if (!d) return;
        const c = await this.contact(tx, d.orderId, null, null, null);
        if (c) await this.record(tx, evt, 'PAYMENT_FAILED', d.orderId, c, { reason: d.reason });
        else this.log.warn(`payment.failed for unknown order ${d.orderId} — no recipient`);
        return;
      }
      case 'payment.refunded.v1': {
        const d = this.parse('payment.refunded.v1', evt);
        if (!d) return;
        const c = await this.contact(tx, d.orderId, null, null, null);
        if (c) await this.record(tx, evt, 'PAYMENT_REFUNDED', d.orderId, c, { amountMinor: d.amount.amountMinor });
        return;
      }
    }
  }

  /** Email outbox: PENDING rows → SMTP, exponential backoff, FAILED after MAX_ATTEMPTS. */
  async sendPending() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.db.transaction(async (tx) => {
        const rows = await tx.query(
          `SELECT * FROM notifications WHERE status = 'PENDING' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
        );
        for (const n of rows) {
          if (!this.mailer) {
            await tx.query(`UPDATE notifications SET status = 'FAILED', last_error = 'SMTP not configured' WHERE id = $1`, [n.id]);
            continue;
          }
          try {
            await this.mailer.sendMail({ from: process.env.SMTP_FROM ?? 'agentic.commerce <orders@agentic.local>', to: n.to_address, subject: n.subject, text: n.body_text, html: n.body_html ?? undefined, headers: { 'X-Notification-Id': n.id } });
            await tx.query(`UPDATE notifications SET status = 'SENT', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [n.id]);
          } catch (e) {
            const attempts = n.attempts + 1;
            rowsOf(
              await tx.query(
                `UPDATE notifications SET attempts = $2, last_error = $3, status = $4, next_attempt_at = now() + ($5 || ' seconds')::interval WHERE id = $1 RETURNING id`,
                [n.id, attempts, (e as Error).message.slice(0, 300), attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', String(2 ** attempts * 5)],
              ),
            );
          }
        }
      });
    } catch (e) {
      this.log.error(`email sender failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
