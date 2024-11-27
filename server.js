require('dotenv').config(); // Load environment variables
const express = require('express');
const stripe = require('stripe')(
    process.env.NODE_ENV === 'production'
        ? process.env.STRIPE_LIVE_SECRET_KEY
        : process.env.STRIPE_TEST_SECRET_KEY
);
const cors = require('cors');
const nodemailer = require('nodemailer');

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

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // Use TLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Function to send confirmation email
const sendConfirmationEmail = async (formData) => {
    const { email, ign, discord, coachingOption, amount } = formData;

    const emailBody = `
        <h1>Coaching Session Confirmation</h1>
        <p>Thank you for booking a coaching session with ProwlerADC!</p>
        <h3>Details:</h3>
        <ul>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>IGN:</strong> ${ign}</li>
            <li><strong>Discord:</strong> ${discord}</li>
            <li><strong>Coaching Option:</strong> ${coachingOption}</li>
            <li><strong>Amount Paid:</strong> $${(amount / 100).toFixed(2)} AUD</li>
        </ul>
        <p>We look forward to helping you improve your gameplay. If you have any questions, feel free to reach out!</p>
    `;

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: `${email}, prowleradc@gmail.com`,
        subject: 'Coaching Session Confirmation',
        html: emailBody
    };

    await transporter.sendMail(mailOptions);
};

// Create Checkout Session route
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { email, ign, discord, coachingOption, amount } = req.body;

        // Validate inputs
        if (!email || !ign || !discord || !coachingOption || !amount) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const validAmounts = [7000, 5000];
        if (!validAmounts.includes(amount)) {
            return res.status(400).json({ error: 'Invalid coaching option selected' });
        }

        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'aud',
                        product_data: {
                            name: `Coaching Option: ${coachingOption}`,
                            description: '1-on-1 Coaching Session'
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${FRONTEND_URL}/thank_you`,
            cancel_url: `${FRONTEND_URL}`
        });

        // Send confirmation email
        await sendConfirmationEmail({ email, ign, discord, coachingOption, amount });

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
