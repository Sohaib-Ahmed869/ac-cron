// services/cartConfig.js
// NOTE: environment variables are loaded once in `Server.js` using dotenv.
// Do not call `require("dotenv").config()` here to avoid duplicate loading/logging.

// Check for critical configuration
if (!process.env.API_KEY) {
  console.warn(
    "WARNING: API_KEY environment variable is not set. API authentication will fail."
  );
}

const config = {
  prestashop: {
    api: {
      // Remove trailing slash to prevent double slashes in URL paths
      baseURL: (
        process.env.PRESTASHOP_URL || process.env.PRESTASHOP_BASE_URL || "https://halalfs.com"
      ).replace(/\/+$/, ""),
      key: "JM9KVG85YKTRHM7D3IZSWLNGBVAC8V5D",
      timeout: parseInt(process.env.PRESTASHOP_TIMEOUT) || 30000,
      retries: parseInt(process.env.PRESTASHOP_RETRIES) || 3
    },
    pagination: {
      defaultLimit: parseInt(process.env.PRESTASHOP_DEFAULT_LIMIT) || 20,
      maxLimit: parseInt(process.env.PRESTASHOP_MAX_LIMIT) || 100
    },
    filters: {
      abandonedCartThresholdHours: parseInt(process.env.ABANDONED_CART_THRESHOLD_HOURS) || 24,
      includedStatuses: (process.env.INCLUDED_CART_STATUSES || '').split(',').filter(Boolean)
    }
  },
  mongodb: {
    uri: process.env.MONGODB_URI || process.env.MONGO_URI,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  },
  server: {
    port: parseInt(process.env.PORT) || 5000,
    env: process.env.NODE_ENV || 'development'
  },
  sync: {
    cronPattern: process.env.SYNC_CRON_PATTERN || '0 * * * *', // Every hour
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE) || 50
  }
};

module.exports = config;