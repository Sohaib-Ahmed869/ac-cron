const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true
  },
  imageUrl: {
    type: String,
    default: null
  }
}, { _id: false });

const contactInfoSchema = new mongoose.Schema({
  phone: {
    type: String,
    default: null
  },
  mobilePhone: {
    type: String,
    default: null
  },
  email: {
    type: String,
    required: true
  }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  cartId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  customerName: {
    type: String,
    required: true
  },
  customerEmail: {
    type: String,
    required: true,
    index: true
  },
  products: [productSchema],
  totalExcludingTaxes: {
    type: Number,
    required: true
  },
  estimatedTaxAmount: {
    type: Number,
    required: true
  },
  totalIncludingTaxes: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: 'EUR'
  },
  createDate: {
    type: Date,
    required: true,
    index: true
  },
  isAbandoned: {
    type: Boolean,
    required: true,
    default: true,
    index: true
  },
  contactInfo: contactInfoSchema,
  source: {
    type: String,
    required: true,
    default: 'Website'
  },
  status: {
    type: String,
    required: true,
    enum: ['abandoned', 'converted', 'expired'],
    default: 'abandoned',
    index: true
  },
  lastModifiedDate: {
    type: Date,
    required: true
  }
}, {
  timestamps: true, // This adds createdAt and updatedAt
  collection: 'carts'
});

// Index for efficient queries
cartSchema.index({ cartId: 1, isAbandoned: 1 });
cartSchema.index({ createDate: -1 });
cartSchema.index({ status: 1, createDate: -1 });

const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;