// Stub environment variables so modules that read them at import time don't throw
process.env.SHOPIFY_API_KEY = "test-key";
process.env.SHOPIFY_API_SECRET = "test-secret";
process.env.SHOPIFY_APP_URL = "https://test.example.com";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.RESEND_API_KEY = "re_test";
