const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cron = require("node-cron");
const axios = require("axios");
const { DateTime } = require("luxon");
require("dotenv").config({ quiet: true });

// Import routes
const cartFetcherRoutes = require("./Routes/cartFetcher.routes");

// Initialize express app
const app = express();

// Environment variables
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/salesHalal";
const NODE_ENV = process.env.NODE_ENV || "development";
const PARIS_TZ = process.env.PARIS_TZ || "Europe/Paris";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// In-memory cron job status for health checks
const cronStatus = {
  enabled: false,
  schedule: null,
  timezone: null,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  lastRunDurationMs: null,
  runCount: 0,
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());

// Logging
if (NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// Routes
app.use("/api/cart-fetcher", cartFetcherRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus =
    dbState === 1 ? "connected" : dbState === 2 ? "connecting" : "disconnected";

  res.json({
    status: "OK",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    db: {
      status: dbStatus,
      readyState: dbState,
    },
    cron: {
      enabled: cronStatus.enabled,
      schedule: cronStatus.schedule,
      timezone: cronStatus.timezone,
      lastRunAt: cronStatus.lastRunAt,
      lastRunStatus: cronStatus.lastRunStatus,
      lastRunError: cronStatus.lastRunError,
      lastRunDurationMs: cronStatus.lastRunDurationMs,
      runCount: cronStatus.runCount,
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: NODE_ENV === "development" ? err.message : "Something went wrong",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${NODE_ENV}`);
  
  // Initialize cron job after server starts
  initializeCronJobs();
});

// Cron job for daily abandoned cart sync
function initializeCronJobs() {
  try {
    const schedule = process.env.CART_SYNC_CRON || '0 3 * * *'; // 03:00 daily
    console.log(`📅 Scheduling daily abandoned cart sync: ${schedule} (${PARIS_TZ})`);

    cronStatus.enabled = true;
    cronStatus.schedule = schedule;
    cronStatus.timezone = PARIS_TZ;
    
    cron.schedule(schedule, async () => {
      try {
        const startTime = Date.now();
        console.log("[CRON] 🔄 Starting abandoned carts sync for last 2 days...");
        
        const nowParis = DateTime.now().setZone(PARIS_TZ);
        const datesToSync = [1, 2].map(offset =>
          nowParis.minus({ days: offset }).toFormat('yyyy-LL-dd')
        );
        
        for (const dateStr of datesToSync) {
          const url = `${BASE_URL}/api/cart-fetcher/abandoned/sync-by-date`;
          console.log(`[CRON] 📊 Syncing date ${dateStr}...`);
          
          const response = await axios.get(url, { 
            params: { date: dateStr, force: true }, 
            timeout: 120000 
          });
          
          console.log(`[CRON] ✅ ${dateStr} -> success=${response.data?.success}, processed=${response.data?.stats?.totalProcessed}`);
        }
        
        console.log("[CRON] ✅ Abandoned carts sync completed successfully.");

        cronStatus.lastRunAt = new Date().toISOString();
        cronStatus.lastRunStatus = "success";
        cronStatus.lastRunError = null;
        cronStatus.lastRunDurationMs = Date.now() - startTime;
        cronStatus.runCount += 1;
      } catch (err) {
        console.error('[CRON] ❌ Error during abandoned carts sync:', err.message);
        cronStatus.lastRunAt = new Date().toISOString();
        cronStatus.lastRunStatus = "error";
        cronStatus.lastRunError = err.message;
        cronStatus.runCount += 1;
      }
    }, { timezone: PARIS_TZ });
    
  } catch (e) {
    console.error('❌ Failed to schedule daily cart sync:', e.message);
    cronStatus.enabled = false;
    cronStatus.lastRunStatus = "schedule_error";
    cronStatus.lastRunError = e.message;
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
  if (NODE_ENV === "development") {
    process.exit(1);
  }
});