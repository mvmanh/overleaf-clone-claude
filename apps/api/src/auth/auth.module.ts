import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard } from '../common/origin.guard';
import { AUTH_PROVIDER } from './auth-provider';
import { AuthController } from './auth.controller';
import { LocalPasswordAuthProvider } from './local-password.provider';
import { PasswordHasher } from './password-hasher';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordHasher,
    SessionService,
    { provide: AUTH_PROVIDER, useClass: LocalPasswordAuthProvider },
    // Order matters: CSRF origin check first, then authentication.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionService, PasswordHasher],
})
export class AuthModule {}
