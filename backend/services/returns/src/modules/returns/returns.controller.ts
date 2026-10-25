import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import {
  AppealInputSchema,
  CaseApproveInputSchema,
  CaseRejectInputSchema,
  EvidenceRequestInputSchema,
  PolicyEvalInputSchema,
  ProposalInputSchema,
  ReturnInputSchema,
} from '@ac/contracts';
import { Principal, type PrincipalInfo, Public, Roles, ZodPipe } from '@ac/nest-common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_EVIDENCE_BYTES } from './evidence-image.js';
import { assertInternal, ReturnsService } from './returns.service.js';

type MultipartRequest = FastifyRequest & { isMultipart(): boolean; file(opts?: { limits?: { fileSize?: number; files?: number } }): Promise<MultipartFile | undefined> };
const ExecuteInputSchema = z.object({ amountMinor: z.int().positive().optional(), runId: z.string().min(1) });

/** Buyer returns + public policy. */
@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  /** POST /v1/returns — buyer who owns the order */
  @Roles('buyer')
  @Post('returns')
  @HttpCode(201)
  create(@Principal() p: PrincipalInfo, @Body(new ZodPipe(ReturnInputSchema)) body: z.infer<typeof ReturnInputSchema>) {
    return this.returns.createReturn(p, body);
  }

  /** GET /v1/returns/mine */
  @Roles('buyer')
  @Get('returns/mine')
  mine(@Principal() p: PrincipalInfo) {
    return this.returns.mine(p);
  }

  /** GET /v1/returns/:id — buyer owner (or staff) */
  @Roles('buyer', 'support', 'finance', 'admin')
  @Get('returns/:id')
  view(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.view(p, id);
  }

  /** POST /v1/returns/:id/evidence — multipart field `file` (JPEG/PNG/WebP ≤ 8 MB) */
  @Roles('buyer')
  @Post('returns/:id/evidence')
  @HttpCode(201)
  async evidence(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Req() req: MultipartRequest) {
    if (!req.isMultipart?.()) throw new BadRequestException('Send multipart/form-data with the photo in field "file"');
    let buf: Buffer;
    try {
      const part = await req.file({ limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1 } });
      if (!part || part.fieldname !== 'file') throw new BadRequestException('Missing multipart field "file"');
      buf = await part.toBuffer();
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new BadRequestException({ code: 'TOO_LARGE', message: 'Photos must be 8 MB or smaller.' });
      throw e;
    }
    return this.returns.addPhoto(p, id, buf);
  }

  /** POST /v1/returns/:id/appeal { note } */
  @Roles('buyer')
  @Post('returns/:id/appeal')
  @HttpCode(200)
  appeal(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AppealInputSchema)) body: z.infer<typeof AppealInputSchema>) {
    return this.returns.appeal(p, id, body.note);
  }

  /** GET /v1/evidence/:id/image?size=thumb|full — buyer owner or staff (private, not cacheable by shared caches) */
  @Roles('buyer', 'support', 'finance', 'admin')
  @Get('evidence/:id/image')
  async image(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Query('size') size: string | undefined, @Res() reply: FastifyReply) {
    const obj = await this.returns.evidenceImage(p, id, size === 'thumb' ? 'thumb' : 'full');
    reply.header('content-type', 'image/webp').header('cache-control', 'private, max-age=3600').header('x-content-type-options', 'nosniff');
    if (obj.length) reply.header('content-length', obj.length);
    return reply.send(obj.body);
  }

  /** GET /v1/refund-policy — active decision table (public) */
  @Public()
  @Get('refund-policy')
  policy() {
    return this.returns.policy();
  }
}

/**
 * Agent ↔ returns. Accepts the realm role `service` (client credentials of `services`) OR an exchanged agent
 * token (act.sub = agent:…) carrying the scope: refunds:read (context, policy-eval), refunds:propose (proposal,
 * request-evidence), refunds:execute (execute). Buyer/staff tokens get 403.
 */
@Controller('internal/refund-cases')
export class InternalController {
  constructor(private readonly returns: ReturnsService) {}

  @Get(':id/context')
  context(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string) {
    assertInternal(p, 'refunds:read');
    return this.returns.context(id);
  }

  @Post(':id/policy-eval')
  @HttpCode(200)
  policyEval(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PolicyEvalInputSchema)) body: z.infer<typeof PolicyEvalInputSchema>) {
    assertInternal(p, 'refunds:read');
    return this.returns.policyEval(id, body.riskScore, body.signals);
  }

  @Post(':id/proposal')
  @HttpCode(201)
  proposal(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ProposalInputSchema)) body: z.infer<typeof ProposalInputSchema>) {
    assertInternal(p, 'refunds:propose');
    return this.returns.proposal(p, id, body);
  }

  @Post(':id/request-evidence')
  @HttpCode(200)
  requestEvidence(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(EvidenceRequestInputSchema)) body: z.infer<typeof EvidenceRequestInputSchema>) {
    assertInternal(p, 'refunds:propose');
    return this.returns.requestEvidence(p, id, body.message, body.runId);
  }

  @Post(':id/execute')
  @HttpCode(200)
  execute(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ExecuteInputSchema)) body: z.infer<typeof ExecuteInputSchema>) {
    assertInternal(p, 'refunds:execute');
    return this.returns.execute(id, body.amountMinor ?? null, p.actor ? `${p.actor} run ${body.runId}` : `service run ${body.runId}`);
  }
}

/** Staff: queue, case detail, approve/reject (dual control), shadow report. */
@Controller('refund-cases')
export class StaffController {
  constructor(private readonly returns: ReturnsService) {}

  /** GET /v1/refund-cases/queue?role=support|finance */
  @Roles('support', 'finance', 'admin')
  @Get('queue')
  queue(@Query('role') role?: string) {
    return this.returns.queue(role || undefined);
  }

  /** GET /v1/refund-cases/shadow-report?days=30 — admin */
  @Roles('admin')
  @Get('shadow-report')
  shadow(@Query('days') days?: string) {
    const d = Number(days ?? 30);
    if (!Number.isInteger(d) || d < 1 || d > 365) throw new BadRequestException('days must be 1–365');
    return this.returns.shadowReport(d);
  }

  @Roles('support', 'finance', 'admin')
  @Get(':id')
  detail(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.detail(p, id);
  }

  @Roles('support', 'finance', 'admin')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CaseApproveInputSchema)) body: z.infer<typeof CaseApproveInputSchema>) {
    return this.returns.approve(p, id, body);
  }

  @Roles('support', 'finance', 'admin')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Principal() p: PrincipalInfo, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CaseRejectInputSchema)) body: z.infer<typeof CaseRejectInputSchema>) {
    return this.returns.reject(p, id, body);
  }
}
