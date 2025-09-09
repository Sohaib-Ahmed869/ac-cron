const PrestaShopCartFetcher = require('../Services/CartFetcherService');
const Cart = require('../Models/Cart');
const config = require('../Services/cartConfig');

// Initialize the cart fetcher with config values
const cartFetcher = new PrestaShopCartFetcher(
  config.prestashop.api.baseURL,
  config.prestashop.api.key,
  {
    timeout: config.prestashop.api.timeout,
    retries: config.prestashop.api.retries,
    defaultLimit: config.prestashop.pagination.defaultLimit,
    maxLimit: config.prestashop.pagination.maxLimit
  }
);

class CartFetcherController {
  // Get all carts with pagination (20 per request by default) 
  async getAllCarts(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(
        parseInt(req.query.limit) || config.prestashop.pagination.defaultLimit,
        config.prestashop.pagination.maxLimit
      );
      const includeRawXml = req.query.includeRaw === 'true';
        
      console.log(`[getAllCarts] Fetching carts - Page: ${page}, Limit: ${limit}`);
      
      const startTime = Date.now();
      const result = await cartFetcher.getAllCarts(page, limit);
      const duration = Date.now() - startTime;
      
      const response = {
        success: true,
        message: 'Carts fetched successfully from PrestaShop',
        duration: `${duration}ms`,
        pagination: {
          currentPage: page,
          requestedLimit: limit,
          actualCount: result.carts.length,
          hasMore: result.pagination.hasMore,
          nextPage: result.pagination.hasMore ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        },
        data: result.carts,
        metadata: {
          totalCartsInPage: result.carts.length,
          abandonedInPage: result.carts.filter(cart => cart.isAbandoned).length,
          apiEndpoint: config.prestashop.api.baseURL,
          fetchedAt: new Date().toISOString()
        }
      };

      // Include raw XML response if requested (for debugging)
      if (includeRawXml) {
        response.rawXmlResponse = result.rawResponse;
      }

      res.status(200).json(response);
    } catch (error) {
      console.error('[getAllCarts] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching carts from PrestaShop',
        error: {
          message: error.message,
          statusCode: error.statusCode,
          endpoint: error.endpoint
        },
        pagination: {
          currentPage: parseInt(req.query.page) || 1,
          requestedLimit: parseInt(req.query.limit) || config.prestashop.pagination.defaultLimit
        }
      });
    }
  }

  // Get abandoned carts specifically with pagination
  async getAbandonedCarts(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(
        parseInt(req.query.limit) || config.prestashop.pagination.defaultLimit,
        config.prestashop.pagination.maxLimit
      );
      const includeRawXml = req.query.includeRaw === 'true';
      const minHours = parseInt(req.query.minHours) || 1; // Minimum hours to consider abandoned
      
      console.log(`[getAbandonedCarts] Fetching abandoned carts - Page: ${page}, Limit: ${limit}, MinHours: ${minHours}`);
      
      const startTime = Date.now();
      const result = await cartFetcher.getAbandonedCarts(page, limit);
      const duration = Date.now() - startTime;
      
      // Additional filtering based on time threshold if specified
      let filteredCarts = result.carts;
      if (minHours > 1) {
        filteredCarts = result.carts.filter(cart => {
          if (!cart.dateAdd) return true;
          const cartAge = (new Date() - cart.dateAdd) / (1000 * 60 * 60);
          return cartAge >= minHours;
        });
      }

      const response = {
        success: true,
        message: 'Abandoned carts fetched successfully from PrestaShop',
        duration: `${duration}ms`,
        pagination: {
          currentPage: page,
          requestedLimit: limit,
          totalCartsScanned: result.pagination.totalCartsChecked,
          abandonedFound: result.pagination.abandonedCount,
          filteredCount: filteredCarts.length,
          hasMore: result.pagination.hasMore,
          nextPage: result.pagination.hasMore ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        },
        filters: {
          minimumAgeHours: minHours,
          appliedAt: new Date().toISOString()
        },
        data: filteredCarts,
        statistics: {
          totalInPage: result.carts.length,
          averageProductsPerCart: filteredCarts.length > 0 ? 
            filteredCarts.reduce((sum, cart) => sum + cart.productCount, 0) / filteredCarts.length : 0,
          oldestCart: filteredCarts.length > 0 ? 
            Math.min(...filteredCarts.map(cart => cart.dateAdd?.getTime()).filter(Boolean)) : null,
          newestCart: filteredCarts.length > 0 ? 
            Math.max(...filteredCarts.map(cart => cart.dateAdd?.getTime()).filter(Boolean)) : null
        }
      };

      // Include raw XML response if requested
      if (includeRawXml) {
        response.rawXmlResponse = result.rawResponse;
      }

      res.status(200).json(response);
    } catch (error) {
      console.error('[getAbandonedCarts] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching abandoned carts from PrestaShop',
        error: {
          message: error.message,
          statusCode: error.statusCode,
          endpoint: error.endpoint
        },
        pagination: {
          currentPage: parseInt(req.query.page) || 1,
          requestedLimit: parseInt(req.query.limit) || config.prestashop.pagination.defaultLimit
        }
      });
    }
  }

  // Get transformed abandoned carts with full product details
  async getTransformedAbandonedCarts(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(
        parseInt(req.query.limit) || config.prestashop.pagination.defaultLimit,
        config.prestashop.pagination.maxLimit
      );
      const useDetailedTransform = req.query.detailed === 'true';
      const includeRawXml = req.query.includeRaw === 'true';
      
      console.log(`[getTransformedAbandonedCarts] Fetching and transforming - Page: ${page}, Limit: ${limit}, Detailed: ${useDetailedTransform}`);
      
      const startTime = Date.now();
      const result = await cartFetcher.getAbandonedCarts(page, limit);
      
      // Transform each cart
      const transformedCarts = [];
      const transformErrors = [];
      
      for (const cart of result.carts) {
        try {
          let transformedCart;
          
          if (useDetailedTransform) {
            // This makes additional API calls for customer and product details
            transformedCart = await cartFetcher.transformCartDataDetailed(cart);
          } else {
            // Simple transformation without additional API calls
            transformedCart = await cartFetcher.transformCartDataSimple(cart);
          }
          
          if (transformedCart) {
            transformedCarts.push(transformedCart);
          }
        } catch (transformError) {
          console.warn(`Error transforming cart ${cart.id}:`, transformError.message);
          transformErrors.push({
            cartId: cart.id,
            error: transformError.message
          });
        }
      }
      
      const duration = Date.now() - startTime;
      
      const response = {
        success: true,
        message: 'Transformed abandoned carts fetched successfully',
        duration: `${duration}ms`,
        transformation: {
          type: useDetailedTransform ? 'detailed' : 'simple',
          successCount: transformedCarts.length,
          errorCount: transformErrors.length,
          errors: transformErrors
        },
        pagination: {
          currentPage: page,
          requestedLimit: limit,
          totalCartsScanned: result.pagination.totalCartsChecked,
          abandonedFound: result.pagination.abandonedCount,
          transformedCount: transformedCarts.length,
          hasMore: result.pagination.hasMore,
          nextPage: result.pagination.hasMore ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        },
        data: transformedCarts,
        statistics: {
          averageCartValue: transformedCarts.length > 0 && transformedCarts[0].totalIncludingTaxes ?
            transformedCarts.reduce((sum, cart) => sum + (cart.totalIncludingTaxes || 0), 0) / transformedCarts.length : null,
          totalValue: transformedCarts.reduce((sum, cart) => sum + (cart.totalIncludingTaxes || 0), 0),
          currencyBreakdown: (() => {
            const breakdown = {};
            transformedCarts.forEach(cart => {
              const currency = cart.currency || 'Unknown';
              if (!breakdown[currency]) {
                breakdown[currency] = {
                  count: 0,
                  totalValue: 0
                };
              }
              breakdown[currency].count++;
              breakdown[currency].totalValue += cart.totalIncludingTaxes || 0;
            });
            return breakdown;
          })()
        }
      };

      if (includeRawXml) {
        response.rawXmlResponse = result.rawResponse;
      }

      res.status(200).json(response);
    } catch (error) {
      console.error('[getTransformedAbandonedCarts] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching transformed abandoned carts',
        error: {
          message: error.message,
          statusCode: error.statusCode,
          endpoint: error.endpoint
        }
      });
    }
  }

  // Manually sync abandoned carts for a specific date (YYYY-MM-DD)
  async syncAbandonedCartsByDate(req, res) {
    try {
      const { date } = req.query;
      const forceOverwrite = req.query.force === 'true';

      if (!date) {
        return res.status(400).json({
          success: false,
          message: 'Date parameter is required (format: YYYY-MM-DD)'
        });
      }

      const targetDate = new Date(date);
      if (isNaN(targetDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      const startTime = Date.now();
      const stats = {
        totalProcessed: 0,
        totalNew: 0,
        totalChanged: 0,
        totalUnchanged: 0,
        totalStaleSkipped: 0,
        pagesProcessed: 1
      };

      const toDate = (val) => {
        if (!val) return null;
        const d = (val instanceof Date) ? val : new Date(val);
        return isNaN(d.getTime()) ? null : d;
      };

      const normalizeForCompare = (doc) => {
        const n = JSON.parse(JSON.stringify(doc));
        if (n.createDate) n.createDate = toDate(n.createDate)?.getTime() || null;
        if (n.lastModifiedDate) n.lastModifiedDate = toDate(n.lastModifiedDate)?.getTime() || null;
        ['totalExcludingTaxes','estimatedTaxAmount','totalIncludingTaxes'].forEach(k => {
          if (n[k] !== undefined && n[k] !== null) n[k] = Number(n[k]);
        });
        if (Array.isArray(n.products)) {
          n.products = n.products.map(p => ({
            name: p.name,
            price: Number(p.price),
            quantity: Number(p.quantity),
            totalPrice: Number(p.totalPrice),
            imageUrl: p.imageUrl || null
          }));
          n.products.sort((a, b) => {
            const ka = `${a.name}|${a.price}|${a.quantity}|${a.totalPrice}|${a.imageUrl || ''}`;
            const kb = `${b.name}|${b.price}|${b.quantity}|${b.totalPrice}|${b.imageUrl || ''}`;
            return ka.localeCompare(kb);
          });
        }
        if (n.contactInfo) {
          n.contactInfo = {
            phone: n.contactInfo.phone || null,
            mobilePhone: n.contactInfo.mobilePhone || null,
            email: (n.contactInfo.email || '').trim()
          };
        }
        delete n._id; delete n.__v; delete n.createdAt; delete n.updatedAt;
        return n;
      };

      const result = await cartFetcher.getCartsByDate(date, config.prestashop.pagination.maxLimit);
      const cartsFromDate = (result.carts || []).filter(c => c.isAbandoned);

      const transformed = [];
      for (const cart of cartsFromDate) {
        const t = await cartFetcher.transformCartDataDetailed(cart);
        if (t) transformed.push(t);
      }

      // Fetch existing carts
      const cartIds = transformed.map(c => c.cartId);
      const existing = await Cart.find(
        { cartId: { $in: cartIds } },
        {
          cartId: 1, clientId: 1, customerName: 1, customerEmail: 1,
          products: 1, totalExcludingTaxes: 1, estimatedTaxAmount: 1, totalIncludingTaxes: 1,
          currency: 1, createDate: 1, isAbandoned: 1, contactInfo: 1, source: 1, status: 1,
          lastModifiedDate: 1
        }
      ).lean();
      const existingMap = new Map(existing.map(c => [String(c.cartId), c]));

      const ops = [];
      let newCount = 0, changedCount = 0, unchangedCount = 0, staleSkipped = 0;
      const newDocs = [];
      const updatedDocs = [];
      const unchangedIds = [];
      const staleSkippedIds = [];

      for (const cart of transformed) {
        const current = existingMap.get(cart.cartId);
        if (!current) {
          ops.push({
            updateOne: {
              filter: { cartId: cart.cartId },
              update: { $set: cart },
              upsert: true
            }
          });
          newCount++;
          newDocs.push(cart);
          continue;
        }

        const incomingLM = toDate(cart.lastModifiedDate)?.getTime() || 0;
        const existingLM = toDate(current.lastModifiedDate)?.getTime() || 0;
        if (!forceOverwrite && existingLM && incomingLM && incomingLM < existingLM) {
          staleSkipped++;
          staleSkippedIds.push(cart.cartId);
          continue;
        }

        const same = require('util').isDeepStrictEqual(
          normalizeForCompare(cart),
          normalizeForCompare(current)
        );
        if (same) {
          unchangedCount++;
          unchangedIds.push(cart.cartId);
        } else {
          ops.push({
            updateOne: {
              filter: { cartId: cart.cartId },
              update: { $set: cart },
              upsert: true
            }
          });
          changedCount++;
          updatedDocs.push(cart);
        }
      }

      if (ops.length > 0) {
        const resBulk = await Cart.bulkWrite(ops, { ordered: false });
        stats.totalNew += resBulk.upsertedCount || 0;
        stats.totalChanged += resBulk.modifiedCount || 0;
      }

      stats.totalProcessed += transformed.length;
      stats.totalUnchanged += unchangedCount;
      stats.totalStaleSkipped += staleSkipped;

      const duration = Date.now() - startTime;
      res.json({
        success: true,
        message: `Manual sync completed for ${date}`,
        date,
        forceOverwrite,
        stats: { ...stats, duration: `${duration}ms` },
        result: {
          new: newDocs,
          updated: updatedDocs,
          unchanged: unchangedIds,
          staleSkipped: staleSkippedIds
        }
      });
    } catch (error) {
      console.error('[syncAbandonedCartsByDate] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Error syncing abandoned carts for date',
        error: error.message
      });
    }
  }
}

module.exports = new CartFetcherController();