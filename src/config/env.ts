import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const env = {
  port: process.env.PORT ?? '4000',
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/finance-tracker',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
};
