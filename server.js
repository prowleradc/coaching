require('dotenv').config(); // Load environment variables
const express = require('express');
const stripe = require('stripe')(
    process.env.NODE_ENV === 'production'
        ? process.env.STRIPE_LIVE_SECRET_KEY
        : process.env.STRIPE_TEST_SECRET_KEY
);
const cors = require('cors');

const app = express();

// Validate environment variables
if (!process.env.STRIPE_TEST_SECRET_KEY && !process.env.STRIPE_LIVE_SECRET_KEY) {
    console.error('Stripe API keys are missing. Please check your .env file.');
    process.exit(1);
}

// Configure CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['https://prowleradc.github.io'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));

app.use(express.json());

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the Coaching Application API!');
});

// Create Checkout Session route
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { amount } = req.body;

        // Validate the amount
        const validAmounts = [7000, 5000]; // Allowed amounts in cents
        if (!validAmounts.includes(amount)) {
            return res.status(400).json({ error: 'Invalid coaching option selected' });
        }

        // Dynamic success and cancel URLs
        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'aud',
                        product_data: {
                            name: 'ADC Coaching',
                            description: `1-on-1 Coaching Session.`,
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${FRONTEND_URL}/thank_you`,
            cancel_url: `${FRONTEND_URL}`,
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Stripe Checkout Session Error:', error);
        res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error.',
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
