const express = require('express');
const cartController = require('../Controller/cartFetcher.controller');

const router = express.Router();

// Only keep the transformed abandoned carts endpoint
router.get('/abandoned/transformed', cartController.getTransformedAbandonedCarts);
router.get('/abandoned/sync-by-date', cartController.syncAbandonedCartsByDate);

module.exports = router;