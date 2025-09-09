const axios = require('axios');
const xml2js = require('xml2js');

class PrestaShopCartFetcher {
  constructor(shopUrl, apiKey, options = {}) {
    this.shopUrl = shopUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.baseUrl = `${this.shopUrl}/api`;
    this.options = {
      timeout: options.timeout || 30000,
      retries: options.retries || 3,
      defaultLimit: options.defaultLimit || 20,
      maxLimit: options.maxLimit || 100,
      useJson: options.useJson || false, // Enable JSON format to avoid XML parsing
      ...options
    };
    
    // Configure axios with basic auth
    this.api = axios.create({
      auth: { username: this.apiKey, password: '' },
      timeout: this.options.timeout
      // no default headers; Accept is set per request
    });

    // XML parser configuration - FIXED to extract clean values
    this.xmlParser = new xml2js.Parser({ 
      explicitArray: false,
      mergeAttrs: false, // Don't merge attributes - this was causing the issue
      normalize: true,
      normalizeTags: true,
      trim: true,
      ignoreAttrs: false,
      attrkey: '@',
      charkey: '#text'
    });
  }

  async makeRequest(endpoint, params = {}, retryCount = 0) {
    try {
      const wantsJson = !!this.options.useJson;

      // Clone params and set correct flag for PrestaShop JSON
      const requestParams = { ...params };
      if (wantsJson) {
        // PrestaShop expects output_format=JSON. Keep both for safety.
        requestParams.output_format = 'JSON';
        requestParams.io_format = 'JSON';
      }

      // Build per-request headers (don't rely on instance defaults)
      const headers = wantsJson
        ? { Accept: 'application/json' }
        : { Accept: 'application/xml' };

      console.log(`Making request to: ${endpoint}`, { params: requestParams, attempt: retryCount + 1, wantsJson });

      const response = await this.api.get(`${this.baseUrl}/${endpoint}`, {
        params: requestParams,
        headers
      });

      // -------- Robust parse: JSON -> fallback to XML --------
      let parsedData = null;
      if (wantsJson) {
        if (typeof response.data === 'string') {
          try {
            parsedData = JSON.parse(response.data);
          } catch (_) {
            // Not valid JSON string; will try XML next
          }
        } else if (response.data && typeof response.data === 'object') {
          parsedData = response.data;
        }

        // If JSON parse didn't yield prestashop root, fallback to XML
        if (!parsedData || !parsedData.prestashop) {
          try {
            parsedData = await this.xmlParser.parseStringPromise(
              typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
            );
          } catch (xmlErr) {
            // Keep parsedData as-is; will throw below
          }
        }
      } else {
        // XML path
        parsedData = await this.xmlParser.parseStringPromise(response.data);
      }

      if (!parsedData || !parsedData.prestashop) {
        throw new Error('Unexpected response format: missing prestashop root');
      }

      return {
        success: true,
        data: parsedData,
        rawXml: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        statusCode: response.status
      };

    } catch (error) {
      console.error(`Error fetching ${endpoint} (attempt ${retryCount + 1}):`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message
      });

      if (retryCount < this.options.retries && this.shouldRetry(error)) {
        const backoff = (retryCount + 1) * 1000;
        console.log(`Retrying request to ${endpoint} in ${backoff}ms...`);
        await this.delay(backoff);
        return this.makeRequest(endpoint, params, retryCount + 1);
      }

      throw {
        success: false,
        error: error.message,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        endpoint,
        params
      };
    }
  }

  shouldRetry(error) {
    // Retry on network errors or 5xx server errors
    return !error.response || error.response.status >= 500;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper method to extract clean value from XML parsed object
  extractValue(xmlValue) {
    if (!xmlValue) return null;
    
    // If it's a simple string or number, return as is
    if (typeof xmlValue === 'string' || typeof xmlValue === 'number') {
      return xmlValue;
    }
    
    // If it's an object with XML structure
    if (typeof xmlValue === 'object') {
      // Check for text content
      if (xmlValue['#text'] !== undefined) {
        return xmlValue['#text'];
      }
      
      // Check for underscore notation (common in xml2js)
      if (xmlValue._ !== undefined) {
        return xmlValue._;
      }
      
      // If it's an object, try to get the first non-attribute value
      const keys = Object.keys(xmlValue).filter(key => !key.startsWith('@') && !key.startsWith('#'));
      if (keys.length > 0) {
        return xmlValue[keys[0]];
      }
      
      // Last resort - return the object itself and let other methods handle it
      return xmlValue;
    }
    
    return xmlValue;
  } 

  // Helper method to clean cart data structure
  cleanCartData(cart) {
    if (!cart) return null;
    
    return {
      id: this.extractValue(cart.id),
      id_customer: this.extractValue(cart.id_customer),
      id_guest: this.extractValue(cart.id_guest),
      id_currency: this.extractValue(cart.id_currency),
      id_lang: this.extractValue(cart.id_lang),
      id_shop: this.extractValue(cart.id_shop),
      id_shop_group: this.extractValue(cart.id_shop_group),
      id_carrier: this.extractValue(cart.id_carrier),
      id_address_delivery: this.extractValue(cart.id_address_delivery),
      id_address_invoice: this.extractValue(cart.id_address_invoice),
      id_order: this.extractValue(cart.id_order),
      delivery_option: this.extractValue(cart.delivery_option),
      secure_key: this.extractValue(cart.secure_key),
      recyclable: this.extractValue(cart.recyclable),
      gift: this.extractValue(cart.gift),
      gift_message: this.extractValue(cart.gift_message),
      mobile_theme: this.extractValue(cart.mobile_theme),
      allow_seperated_package: this.extractValue(cart.allow_seperated_package),
      date_add: this.extractValue(cart.date_add),
      date_upd: this.extractValue(cart.date_upd),
      associations: cart.associations
    };
  }

  async getAllCarts(page = 1, limit = null) {
    try {
      const pageLimit = limit || this.options.defaultLimit;
      const offset = (page - 1) * pageLimit;
      
      console.log(`Fetching carts - Page: ${page}, Limit: ${pageLimit}, Offset: ${offset}`);
      
      const response = await this.makeRequest('carts', {
        display: 'full',
        limit: `${offset},${pageLimit}`,
        sort: '[id_DESC]' // Get newest carts first
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      const prestashopData = response.data.prestashop;
      
      if (!prestashopData || !prestashopData.carts) {
        return {
          carts: [],
          pagination: {
            currentPage: page,
            limit: pageLimit,
            count: 0,
            hasMore: false
          },
          rawResponse: response.rawXml
        };
      }

      let carts = prestashopData.carts.cart;
      
      // Handle single cart response (not an array)
      if (!Array.isArray(carts)) {
        carts = carts ? [carts] : [];
      }

      // Clean and enrich cart data with additional fields
      const enrichedCarts = carts.map(cart => this.enrichCartData(cart));

      return {
        carts: enrichedCarts,
        pagination: {
          currentPage: page,
          limit: pageLimit,
          count: enrichedCarts.length,
          hasMore: enrichedCarts.length === pageLimit
        },
        rawResponse: response.rawXml
      };
    } catch (error) {
      console.error('Error in getAllCarts:', error);
      throw error;
    }
  }

  async getAbandonedCarts(page = 1, limit = null) {
    try {
      const pageLimit = limit || this.options.defaultLimit;
      
      console.log(`Fetching abandoned carts - Page: ${page}, Limit: ${pageLimit}`);
      
      // Get all carts for this page
      const result = await this.getAllCarts(page, pageLimit);
      
      // Filter for abandoned carts
      const abandonedCarts = result.carts.filter(cart => this.isAbandonedCart(cart));
      
      console.log(`Found ${abandonedCarts.length} abandoned carts out of ${result.carts.length} total carts`);
      
      return {
        carts: abandonedCarts,
        pagination: {
          ...result.pagination,
          abandonedCount: abandonedCarts.length,
          totalCartsChecked: result.carts.length
        },
        rawResponse: result.rawResponse
      };
    } catch (error) {
      console.error('Error in getAbandonedCarts:', error);
      throw error;
    }
  }

  async getCartsByDate(dateString, perRequestLimit = null) {
    try {
      const start = new Date(dateString);
      if (isNaN(start.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }
      const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')} 00:00:00`;
      const endStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')} 23:59:59`;

      const pageLimit = perRequestLimit || this.options.maxLimit || 100;
      const allCarts = [];
      let offset = 0;

      console.log(`Fetching ALL carts by date ${dateString} in batches of ${pageLimit}`);

      while (true) {
        const response = await this.makeRequest('carts', {
          display: 'full',
          'filter[date_add]': `[${startStr},${endStr}]`,
          date: 1,
          sort: '[id_DESC]',
          limit: `${offset},${pageLimit}`
        });

        if (!response.success) {
          throw new Error(response.error);
        }

        const prestashopData = response.data.prestashop;
        if (!prestashopData || !prestashopData.carts) {
          break;
        }

        let carts = prestashopData.carts.cart;
        if (!Array.isArray(carts)) {
          carts = carts ? [carts] : [];
        }

        if (carts.length === 0) {
          break;
        }

        allCarts.push(...carts.map(cart => this.enrichCartData(cart)));

        if (carts.length < pageLimit) {
          break;
        }

        offset += pageLimit;
      }

      return {
        carts: allCarts,
        pagination: {
          currentPage: 1,
          limit: pageLimit,
          count: allCarts.length,
          hasMore: false
        },
        rawResponse: null
      };
    } catch (error) {
      console.error('Error in getCartsByDate:', error);
      throw error;
    }
  }

  async getAddressDetails(addressId) {
    try {
      if (!addressId || addressId === '0') {
        return null;
      }

      console.log(`Fetching address details for ID: ${addressId}`);
      
      const response = await this.makeRequest(`addresses/${addressId}`, {
        display: 'full'
      });

      if (!response.success) {
        console.warn(`Failed to fetch address ${addressId}:`, response.error);
        return null;
      }

      const address = response.data.prestashop?.address;
      if (!address) return null;

      // Clean address data
      return {
        id: this.extractValue(address.id),
        firstname: this.extractValue(address.firstname),
        lastname: this.extractValue(address.lastname),
        company: this.extractValue(address.company),
        phone: this.extractValue(address.phone),
        phone_mobile: this.extractValue(address.phone_mobile),
        address1: this.extractValue(address.address1),
        address2: this.extractValue(address.address2),
        city: this.extractValue(address.city),
        postcode: this.extractValue(address.postcode),
        id_country: this.extractValue(address.id_country)
      };
    } catch (error) {
      console.warn(`Error fetching address ${addressId}:`, error.message);
      return null;
    }
  }

  async getProductsBatch(ids) {
    try {
      if (!ids || ids.length === 0) return {};
      
      const uniqueIds = [...new Set(ids)].join('|');
      console.log(`Fetching batch product details for IDs: ${uniqueIds}`);
      
      const response = await this.makeRequest('products', {
        'filter[id]': `[${uniqueIds}]`,
        display: '[id,name,price,reference,id_default_image,weight,active,available_for_order,manufacturer_name]',
        limit: '0,1000'
      });

      if (!response.success) {
        console.warn('Failed to fetch batch products:', response.error);
        return {};
      }

      const prestashopData = response.data.prestashop;
      if (!prestashopData || !prestashopData.products) {
        return {};
      }

      const productList = prestashopData.products.product;
      const products = Array.isArray(productList) ? productList : [productList];
      
      const productMap = {};
      for (const product of products) {
        const productId = this.extractValue(product.id);
        if (productId) {
          productMap[productId] = {
            id: productId,
            name: this.extractMultiLanguageField(product.name),
            price: parseFloat(this.extractValue(product.price)) || 0,
            reference: this.extractValue(product.reference),
            weight: parseFloat(this.extractValue(product.weight)) || 0,
            manufacturer_name: this.extractValue(product.manufacturer_name),
            id_default_image: this.extractValue(product.id_default_image),
            active: this.extractValue(product.active),
            available_for_order: this.extractValue(product.available_for_order)
          };
        }
      }

      return productMap;
    } catch (error) {
      console.warn('Error in getProductsBatch:', error.message);
      return {};
    }
  }

  async getCustomersBatch(ids) {
    try {
      const validIds = ids.filter(id => id && id !== '0');
      if (validIds.length === 0) return {};
      
      const uniqueIds = [...new Set(validIds)].join('|');
      console.log(`Fetching batch customer details for IDs: ${uniqueIds}`);
      
      const response = await this.makeRequest('customers', {
        'filter[id]': `[${uniqueIds}]`,
        display: '[id,firstname,lastname,email,is_guest,date_add,date_upd]',
        limit: '0,1000'
      });

      if (!response.success) {
        console.warn('Failed to fetch batch customers:', response.error);
        return {};
      }

      const prestashopData = response.data.prestashop;
      if (!prestashopData || !prestashopData.customers) {
        return {};
      }

      const customerList = prestashopData.customers.customer;
      const customers = Array.isArray(customerList) ? customerList : [customerList];
      
      const customerMap = {};
      for (const customer of customers) {
        const customerId = this.extractValue(customer.id);
        if (customerId) {
          customerMap[customerId] = {
            id: customerId,
            firstname: this.extractValue(customer.firstname),
            lastname: this.extractValue(customer.lastname),
            email: this.extractValue(customer.email),
            is_guest: this.extractValue(customer.is_guest) === '1',
            date_add: this.extractValue(customer.date_add),
            date_upd: this.extractValue(customer.date_upd)
          };
        }
      }

      return customerMap;
    } catch (error) {
      console.warn('Error in getCustomersBatch:', error.message);
      return {};
    }
  }

  extractMultiLanguageField(field, langId = null) {
    if (!field) return '';
    
    if (typeof field === 'string') {
      return field;
    }
    
    if (typeof field === 'object') {
      // Handle multi-language fields
      if (field.language) {
        const arr = Array.isArray(field.language) ? field.language : [field.language];
        
        // If langId is provided, try to find matching language
        if (langId) {
          const match = arr.find(l => this.extractValue(l['@']?.id) == langId);
          if (match) {
            return this.extractValue(match) || '';
          }
        }
        
        // Fallback to first available language
        return this.extractValue(arr[0]) || '';
      }
      
      // Fallback to any text content
      return this.extractValue(field) || '';
    }
    
    return '';
  }

  enrichCartData(cart) {
    // Clean the cart data first
    const cleanCart = this.cleanCartData(cart);
    
    // Add computed fields
    const enrichedCart = {
      ...cleanCart,
      // Add computed fields
      isAbandoned: this.isAbandonedCart(cleanCart),
      productCount: this.getCartProductCount(cleanCart),
      cartValue: this.calculateCartValue(cleanCart),
      // Convert dates to proper format
      dateAdd: cleanCart.date_add ? new Date(cleanCart.date_add) : null,
      dateUpd: cleanCart.date_upd ? new Date(cleanCart.date_upd) : null,
      // Clean associations
      products: this.extractCartProducts(cleanCart)
    };

    return enrichedCart;
  }

  isAbandonedCart(cart) {
    // A cart is considered abandoned if:
    // 1. It has no associated order (id_order is 0 or empty)
    // 2. It has products in it
    // 3. It's older than a certain threshold (optional)
    
    const hasOrder = cart.id_order && cart.id_order !== '0';
    const hasProducts = this.getCartProductCount(cart) > 0;
    
    // Optional: Check if cart is old enough to be considered abandoned
    const isOldEnough = cart.date_add ? 
      this.isCartOldEnough(cart.date_add) : true;
    
    return !hasOrder && hasProducts && isOldEnough;
  }

  isCartOldEnough(dateAdd, thresholdHours = 1) {
    const cartDate = new Date(dateAdd);
    const now = new Date();
    const diffHours = (now - cartDate) / (1000 * 60 * 60);
    return diffHours >= thresholdHours;
  }

  getCartProductCount(cart) {
    if (!cart.associations || !cart.associations.cart_rows) {
      return 0;
    }

    const cartRows = cart.associations.cart_rows.cart_row;
    if (!cartRows) {
      return 0;
    }

    if (Array.isArray(cartRows)) {
      return cartRows.length;
    } else {
      return 1;
    }
  }

  extractCartProducts(cart) {
    if (!cart.associations || !cart.associations.cart_rows) {
      return [];
    }

    const cartRows = cart.associations.cart_rows.cart_row;
    if (!cartRows) {
      return [];
    }

    if (Array.isArray(cartRows)) {
      return cartRows.map(row => ({
        productId: this.extractValue(row.id_product),
        productAttributeId: this.extractValue(row.id_product_attribute),
        quantity: parseInt(this.extractValue(row.quantity)) || 0,
        addressDeliveryId: this.extractValue(row.id_address_delivery),
        customizationId: this.extractValue(row.id_customization)
      }));
    } else {
      return [{
        productId: this.extractValue(cartRows.id_product),
        productAttributeId: this.extractValue(cartRows.id_product_attribute),
        quantity: parseInt(this.extractValue(cartRows.quantity)) || 0,
        addressDeliveryId: this.extractValue(cartRows.id_address_delivery),
        customizationId: this.extractValue(cartRows.id_customization)
      }];
    }
  }

  calculateCartValue(cart) {
    const products = this.extractCartProducts(cart);
    return {
      totalItems: products.reduce((total, product) => total + product.quantity, 0),
      uniqueProducts: products.length
    };
  }

  async transformCartDataSimple(cart) {
    try {
      // Clean the cart data first
      const cleanCart = this.cleanCartData(cart);
      
      // Simplified transformation without additional API calls
      const products = this.extractCartProducts(cleanCart);
      
      const transformedCart = {
        cartId: cleanCart.id,
        clientId: cleanCart.id_customer,
        guestId: cleanCart.id_guest,
        currencyId: cleanCart.id_currency,
        languageId: cleanCart.id_lang,
        shopId: cleanCart.id_shop,
        carrierId: cleanCart.id_carrier,
        deliveryAddressId: cleanCart.id_address_delivery,
        invoiceAddressId: cleanCart.id_address_invoice,
        secureKey: cleanCart.secure_key,
        products: products,
        productCount: products.length,
        totalQuantity: products.reduce((total, p) => total + p.quantity, 0),
        createDate: cleanCart.date_add ? new Date(cleanCart.date_add) : null,
        lastModifiedDate: cleanCart.date_upd ? new Date(cleanCart.date_upd) : null,
        isAbandoned: this.isAbandonedCart(cleanCart),
        status: this.isAbandonedCart(cleanCart) ? 'abandoned' : 'active',
        source: 'PrestaShop',
        deliveryOption: cleanCart.delivery_option || '',
        gift: cleanCart.gift === '1',
        giftMessage: cleanCart.gift_message || '',
        recyclable: cleanCart.recyclable === '1',
        mobileTheme: cleanCart.mobile_theme === '1'
      };

      return transformedCart;
    } catch (error) {
      console.error('Error in simple cart transformation:', error);
      return null;
    }
  }

  async transformCartDataDetailed(cart) {
    try {
      // Clean the cart data first
      const cleanCart = this.cleanCartData(cart);
      
      // Extract product IDs and customer ID for batch fetching
      const products = this.extractCartProducts(cleanCart);
      const productIds = products.map(p => p.productId);
      const customerIds = cleanCart.id_customer && cleanCart.id_customer !== '0' ? [cleanCart.id_customer] : [];
      
      // Batch fetch all data in parallel
      const [productMap, customerMap, deliveryAddr, invoiceAddr] = await Promise.all([
        this.getProductsBatch(productIds),
        this.getCustomersBatch(customerIds),
        this.getAddressDetails(cleanCart.id_address_delivery),
        this.getAddressDetails(cleanCart.id_address_invoice)
      ]);

      // Get customer data
      const customer = customerMap[cleanCart.id_customer] || null;

      // Build product lines using batch data
      const cartProducts = [];
      let totalExcludingTaxes = 0;
      
      for (const cartProduct of products) {
        const productDetails = productMap[cartProduct.productId];
        
        if (productDetails) {
          const price = productDetails.price || 0;
          const quantity = cartProduct.quantity;
          const totalPrice = price * quantity;
          
          cartProducts.push({
            productId: cartProduct.productId,
            name: this.extractMultiLanguageField(productDetails.name, cleanCart.id_lang) || 'Unknown Product',
            price: price,
            quantity: quantity,
            totalPrice: totalPrice,
            reference: productDetails.reference,
            weight: productDetails.weight || 0,
            manufacturer_name: productDetails.manufacturer_name,
            imageUrl: productDetails.id_default_image 
              ? `${this.shopUrl}/api/images/products/${cartProduct.productId}/${productDetails.id_default_image}`
              : null
          });
          
          totalExcludingTaxes += totalPrice;
        }
      }

      // Get phone number from addresses (preferred over customer data)
      const phone = deliveryAddr?.phone || deliveryAddr?.phone_mobile ||
                   invoiceAddr?.phone || invoiceAddr?.phone_mobile ||
                   customer?.phone || customer?.phone_mobile || null;

      // Calculate tax estimates (adjust based on your tax configuration)
      const taxRate = 0.055; // 5.5% tax rate - adjust as needed
      const estimatedTaxAmount = totalExcludingTaxes * taxRate;
      const totalIncludingTaxes = totalExcludingTaxes + estimatedTaxAmount;

      return {
        cartId: cleanCart.id,
        clientId: cleanCart.id_customer,
        customerName: customer ? `${customer.firstname} ${customer.lastname}`.trim() : 'Guest Customer',
        customerEmail: customer?.email || '',
        products: cartProducts,
        totalExcludingTaxes: Math.round(totalExcludingTaxes * 100) / 100,
        estimatedTaxAmount: Math.round(estimatedTaxAmount * 100) / 100,
        totalIncludingTaxes: Math.round(totalIncludingTaxes * 100) / 100,
        currency: 'EUR', // You might want to fetch this from currency ID
        createDate: new Date(cleanCart.date_add),
        isAbandoned: this.isAbandonedCart(cleanCart),
        contactInfo: {
          phone: phone,
          email: customer?.email || ''
        },
        shippingAddress: deliveryAddr || null,
        billingAddress: invoiceAddr || null,
        source: 'PrestaShop',
        status: this.isAbandonedCart(cleanCart) ? 'abandoned' : 'active',
        lastModifiedDate: new Date(cleanCart.date_upd)
      };
    } catch (error) {
      console.error('Error in detailed cart transformation:', error);
      return null;
    }
  }

  
}

module.exports = PrestaShopCartFetcher;