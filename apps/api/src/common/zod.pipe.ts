import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { ApiException } from './api-exception';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ApiException(
      'VALIDATION_FAILED',
      'Request validation failed.',
      HttpStatus.BAD_REQUEST,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
}
