import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const DEFAULT_JWT_SECRET = 'change-me';

// A token signed with the well-known fallback secret is forgeable by anyone
// who's read this file — refuse to boot in production rather than silently
// serving auth with a secret that isn't actually secret.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const env = {
  port: process.env.PORT ?? '4000',
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/finance-tracker',
  jwtSecret: process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
};
