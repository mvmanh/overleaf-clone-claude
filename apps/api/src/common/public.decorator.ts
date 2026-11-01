import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'lc:isPublic';
/** Opts a route out of the global session guard. Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
