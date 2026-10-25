import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** `@Body(new ZodPipe(CreateProductSchema)) dto: CreateProduct` — schemas live in @ac/contracts. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException({ message: 'Validation failed', issues: r.error.issues.slice(0, 20) });
    return r.data;
  }
}
